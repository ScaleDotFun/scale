// ──────────────────────────────────────────────
// SCALE PROTOCOL — live tick engine (Solana / Jupiter)
//
// Memecoin traders live on seconds-charts, and no aggregator serves
// sub-minute candles for Solana — so we build them ourselves: one
// global poller asks Jupiter's price feed for every watched mint in a
// single batched call every ~1.2s and folds each price into that
// mint's current 1-second bucket. The poll carries no trade volume,
// so volume is honestly 0 — the price line is real, not interpolated
// beyond Jupiter's own aggregation.
//
// Watchers spin up on demand per mint and self-expire after 90s
// without a reader.
// ──────────────────────────────────────────────

import { getUsdPrices } from '@scale/solana';

export interface LiveCandle {
  timestamp: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD (always 0 — price polls carry no volume)
}

export interface Watcher {
  mint: string;
  /** 1-second buckets, ascending */
  candles: LiveCandle[];
  lastPriceUsd: number;
  lastAccess: number;
}

const watchers = new Map<string, Watcher>();

const POLL_MS = 1_200;
const IDLE_EXPIRE_MS = 90_000;
const MAX_BUCKETS = 3_600; // 1h of 1s candles per mint

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

/** Fold a polled price into the watcher's 1s candle buffer. */
function foldPrice(w: Watcher, ts: number, priceUsd: number): void {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  w.lastPriceUsd = priceUsd;
  const last = w.candles[w.candles.length - 1];
  if (last && last.timestamp === ts) {
    last.high = Math.max(last.high, priceUsd);
    last.low = Math.min(last.low, priceUsd);
    last.close = priceUsd;
  } else if (!last || ts > last.timestamp) {
    // open at previous close so candles chain like a real tape
    const open = last ? last.close : priceUsd;
    w.candles.push({
      timestamp: ts,
      open,
      high: Math.max(open, priceUsd),
      low: Math.min(open, priceUsd),
      close: priceUsd,
      volume: 0,
    });
    if (w.candles.length > MAX_BUCKETS) w.candles.splice(0, w.candles.length - MAX_BUCKETS);
  }
  // out-of-order timestamps (older than the last bucket) are dropped
}

/** One tick: expire idle watchers, then price every active mint in ONE call. */
async function pollAll(): Promise<void> {
  if (polling) return; // never overlap slow polls
  polling = true;
  try {
    const now = Date.now();
    for (const [mint, w] of watchers) {
      if (now - w.lastAccess > IDLE_EXPIRE_MS) watchers.delete(mint);
    }
    if (watchers.size === 0) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    const prices = await getUsdPrices([...watchers.keys()]);
    const ts = Math.floor(Date.now() / 1000);
    for (const [mint, w] of watchers) {
      const p = prices.get(mint);
      if (p) foldPrice(w, ts, p.usdPrice);
    }
  } catch (err) {
    // transient API hiccup — next tick retries; watchers keep last state
    console.warn('[liveTicks] poll failed:', err instanceof Error ? err.message.slice(0, 120) : err);
  } finally {
    polling = false;
  }
}

function ensurePolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(pollAll, POLL_MS);
  pollTimer.unref?.();
}

/**
 * Get (or start) the live watcher for a mint. A new watcher is seeded
 * with a single bucket at the current price — no 1s history exists
 * anywhere, so pretending otherwise would be fakery.
 */
export async function watchToken(mint: string): Promise<Watcher> {
  let w = watchers.get(mint);
  if (!w) {
    w = { mint, candles: [], lastPriceUsd: 0, lastAccess: Date.now() };
    watchers.set(mint, w);
    try {
      const prices = await getUsdPrices([mint]);
      const p = prices.get(mint);
      if (p) foldPrice(w, Math.floor(Date.now() / 1000), p.usdPrice);
    } catch (err) {
      console.warn('[liveTicks] seed price failed:', err instanceof Error ? err.message.slice(0, 120) : err);
    }
    ensurePolling();
  }
  w.lastAccess = Date.now();
  return w;
}

/**
 * Aggregated candles for a timeframe (1/5/15 seconds), ascending.
 * The current bucket always exists at the last polled price so charts
 * tick forward in real time — that price is real market data, not fill.
 */
export function liveCandles(w: Watcher, tfSec: number, limit = 300): { candles: LiveCandle[]; last: number } {
  const byBucket = new Map<number, LiveCandle>();
  for (const c of w.candles) {
    const bucket = Math.floor(c.timestamp / tfSec) * tfSec;
    const agg = byBucket.get(bucket);
    if (!agg) {
      byBucket.set(bucket, { ...c, timestamp: bucket });
    } else {
      agg.high = Math.max(agg.high, c.high);
      agg.low = Math.min(agg.low, c.low);
      agg.close = c.close;
      agg.volume += c.volume;
    }
  }
  const out = Array.from(byBucket.values()).sort((a, b) => a.timestamp - b.timestamp);

  // live current bucket (chains from previous close; real last price)
  if (w.lastPriceUsd > 0) {
    const nowBucket = Math.floor(Date.now() / 1000 / tfSec) * tfSec;
    const tail = out[out.length - 1];
    if (!tail || tail.timestamp < nowBucket) {
      const open = tail ? tail.close : w.lastPriceUsd;
      out.push({
        timestamp: nowBucket,
        open,
        high: Math.max(open, w.lastPriceUsd),
        low: Math.min(open, w.lastPriceUsd),
        close: w.lastPriceUsd,
        volume: 0,
      });
    }
  }
  return { candles: out.slice(-limit), last: w.lastPriceUsd };
}
