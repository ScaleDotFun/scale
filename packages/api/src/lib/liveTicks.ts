// ──────────────────────────────────────────────
// LOADED PROTOCOL — live tick engine (Robinhood Chain)
//
// Memecoin traders live on seconds-charts, and nobody serves sub-minute
// candles for Robinhood Chain — so we build them here from two real
// GeckoTerminal feeds:
//
//   1. Pool trades. Every confirmed PONS swap carries a block timestamp,
//      a USD price and a USD size, so the seconds where trading actually
//      happened get REAL open/high/low/close and REAL volume. GT indexes
//      them ~10-20s behind the chain, so they land in buckets that
//      usually already exist and are merged in place.
//   2. Batched token price. One call prices every watched token at once
//      and keeps the tape ticking while a coin is quiet.
//
// Watchers spin up on demand per token and self-expire after 90s without
// a reader. Cadences are deliberately slow: getUsdPrices has no Pro path,
// so the price poll shares GeckoTerminal's ~30 req/min free-tier budget
// with everything else this process does.
// ──────────────────────────────────────────────

import { getUsdPrices, GT_NETWORK } from '@loaded/evm';
import { fetchTrades, type PoolTrade } from './geckoterminal.js';

export interface LiveCandle {
  timestamp: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD (real swap volume; price-poll ticks add 0)
}

export interface Watcher {
  address: string;
  /** 1-second buckets, ascending */
  candles: LiveCandle[];
  lastPriceUsd: number;
  lastAccess: number;
  /** swap fingerprints already folded (dedupe across trade polls) */
  seenTrades: Set<string>;
  /** ms timestamp of the last trades poll */
  lastTradesPoll: number;
}

/** Keyed by lowercased address — callers pass mixed-case hex. */
const watchers = new Map<string, Watcher>();

const key = (addr: string): string => addr.trim().toLowerCase();

const POLL_MS = 3_000;
const IDLE_EXPIRE_MS = 90_000;
const MAX_BUCKETS = 3_600; // ≈1h of 1s candles per token
/** Trades poll cadence per watcher (real volume, ~10-20s behind chain). */
const TRADES_POLL_MS = 10_000;
/** Swaps pulled per poll, and on the opening backfill. */
const TRADES_PER_POLL = 30;
const SEED_TRADES = 60;
const MAX_SEEN_TRADES = 3_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

/** Fold a price observation into the watcher's 1s candle buffer. */
function fold(w: Watcher, ts: number, priceUsd: number, volumeUsd: number): void {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  w.lastPriceUsd = priceUsd;
  const last = w.candles[w.candles.length - 1];
  if (last && last.timestamp === ts) {
    last.high = Math.max(last.high, priceUsd);
    last.low = Math.min(last.low, priceUsd);
    last.close = priceUsd;
    last.volume += volumeUsd;
  } else if (!last || ts > last.timestamp) {
    // open at previous close so candles chain like a real tape
    const open = last ? last.close : priceUsd;
    w.candles.push({
      timestamp: ts,
      open,
      high: Math.max(open, priceUsd),
      low: Math.min(open, priceUsd),
      close: priceUsd,
      volume: volumeUsd,
    });
    if (w.candles.length > MAX_BUCKETS) w.candles.splice(0, w.candles.length - MAX_BUCKETS);
  }
  // out-of-order timestamps (older than the last bucket) are dropped
}

// ── GeckoTerminal trades (real price + volume, slight latency) ─

/**
 * Merge a confirmed swap into the buffer at ITS OWN second — trades
 * arrive behind the chain, so they usually land in buckets that already
 * exist. Volume adds up; high/low widen; close only moves for the newest
 * bucket so the live price stays authoritative.
 */
function mergeTrade(w: Watcher, ts: number, priceUsd: number, volumeUsd: number): void {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  const cs = w.candles;
  const last = cs[cs.length - 1];
  if (!last || ts > last.timestamp) {
    fold(w, ts, priceUsd, volumeUsd);
    return;
  }
  if (ts < cs[0].timestamp) return; // older than the whole buffer — too stale to chart
  // walk from the tail — trades are always recent, so this exits in a few steps
  for (let i = cs.length - 1; i >= 0; i--) {
    if (cs[i].timestamp === ts) {
      cs[i].high = Math.max(cs[i].high, priceUsd);
      cs[i].low = Math.min(cs[i].low, priceUsd);
      cs[i].volume += volumeUsd;
      if (i === cs.length - 1) cs[i].close = priceUsd;
      return;
    }
    if (cs[i].timestamp < ts) {
      // no bucket at this second — splice one in, chained off the neighbor
      const open = cs[i].close;
      cs.splice(i + 1, 0, {
        timestamp: ts,
        open,
        high: Math.max(open, priceUsd),
        low: Math.min(open, priceUsd),
        close: priceUsd,
        volume: volumeUsd,
      });
      return;
    }
  }
}

/**
 * Fingerprint a swap. One transaction can carry several swaps of the same
 * token, so the hash alone would silently drop volume — size and second
 * separate them, and a re-poll of the same swap reproduces the key exactly.
 */
function tradeKey(t: PoolTrade): string {
  return `${t.txHash}:${t.blockUnixTime}:${t.tokenAmount}:${t.volumeUsd}`;
}

/** Poll recent trades for a watcher and fold the unseen ones. */
async function pollTrades(w: Watcher, limit = TRADES_PER_POLL): Promise<void> {
  try {
    // oldest-first so backfill builds the buffer in natural order
    const trades = (await fetchTrades(w.address, limit)).sort((a, b) => a.blockUnixTime - b.blockUnixTime);
    for (const t of trades) {
      const k = tradeKey(t);
      if (w.seenTrades.has(k)) continue;
      w.seenTrades.add(k);
      if (w.seenTrades.size > MAX_SEEN_TRADES) {
        const oldest = w.seenTrades.values().next().value;
        if (oldest) w.seenTrades.delete(oldest);
      }
      mergeTrade(w, t.blockUnixTime, t.priceUsd, t.volumeUsd);
    }
  } catch {
    // GT hiccup — the price poll still carries the tape
  }
}

// ── Batched price poll (gap filler + seed) ───────────────────

/**
 * Batched USD prices, re-keyed lowercase: GeckoTerminal answers with
 * EIP-55 checksummed addresses, which never match a raw route param.
 */
async function usdPrices(addresses: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const [addr, p] of await getUsdPrices(addresses)) {
    if (p.priceUsd > 0) out.set(key(addr), p.priceUsd);
  }
  return out;
}

/** One tick: expire idle watchers, then price every active token in ONE call. */
async function pollAll(): Promise<void> {
  if (polling) return; // never overlap slow polls
  polling = true;
  try {
    const now = Date.now();
    for (const [k, w] of watchers) {
      if (now - w.lastAccess > IDLE_EXPIRE_MS) watchers.delete(k);
    }
    if (watchers.size === 0) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    const live = [...watchers.values()];
    const prices = await usdPrices(live.map((w) => w.address));
    const ts = Math.floor(Date.now() / 1000);
    const due: Promise<void>[] = [];
    for (const w of live) {
      const price = prices.get(key(w.address));
      if (price) fold(w, ts, price, 0);
      if (now - w.lastTradesPoll > TRADES_POLL_MS) {
        w.lastTradesPoll = now;
        due.push(pollTrades(w));
      }
    }
    if (due.length > 0) await Promise.allSettled(due);
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
  console.log(`[liveTicks] tape started (${GT_NETWORK})`);
}

/**
 * Get (or start) the live watcher for a token. A new watcher backfills
 * from the last real swaps — no 1s history exists anywhere else, so
 * pretending otherwise would be fakery. From there the trades poll adds
 * real volume and the price poll keeps the tape moving.
 */
export async function watchToken(address: string): Promise<Watcher> {
  const k = key(address);
  let w = watchers.get(k);
  if (!w) {
    w = {
      address,
      candles: [],
      lastPriceUsd: 0,
      lastAccess: Date.now(),
      seenTrades: new Set(),
      lastTradesPoll: Date.now(),
    };
    watchers.set(k, w);
    // open the chart on genuine recent history instead of a single dot
    await pollTrades(w, SEED_TRADES);
    try {
      const price = (await usdPrices([address])).get(k);
      if (price) fold(w, Math.floor(Date.now() / 1000), price, 0);
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
 * The current bucket always exists at the last observed price so charts
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
