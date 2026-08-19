// ──────────────────────────────────────────────
// SCALE PROTOCOL — live tick engine (Solana)
//
// Memecoin traders live on seconds-charts, and no aggregator serves
// sub-minute candles for Solana — so we build them ourselves from two
// real sources:
//
//   1. PumpPortal's public trade stream (wss://pumpportal.fun/api/data)
//      broadcasts every pump.fun trade — bonding curve and graduated
//      AMM alike — the moment it lands. Each trade carries SOL in/out,
//      so candles get REAL prices and REAL USD volume per second.
//   2. Jupiter's price feed, polled in one batched call every ~1.2s,
//      fills the gaps: it keeps the tape ticking when a coin goes
//      quiet and seeds new watchers. Jupiter refreshes every few
//      seconds, so trades always win when both arrive.
//
// Watchers spin up on demand per mint and self-expire after 90s
// without a reader; the socket resubscribes automatically after drops.
// ──────────────────────────────────────────────

import { getUsdPrices, getSolUsd } from '@scale/solana';
import { fetchTrades } from './geckoterminal.js';

export interface LiveCandle {
  timestamp: number; // unix seconds (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // USD (real trade volume via PumpPortal; poll fills add 0)
}

export interface Watcher {
  mint: string;
  /** 1-second buckets, ascending */
  candles: LiveCandle[];
  lastPriceUsd: number;
  lastAccess: number;
  /** ms timestamp of the last streamed trade (0 = none yet) */
  lastTradeAt: number;
  /** tx hashes already folded (dedupe across trade polls) */
  seenTrades: Set<string>;
  /** ms timestamp of the last GT trades poll */
  lastTradesPoll: number;
}

const watchers = new Map<string, Watcher>();

const POLL_MS = 1_200;
const IDLE_EXPIRE_MS = 90_000;
const MAX_BUCKETS = 3_600; // 1h of 1s candles per mint
/** A polled price only fills when no trade streamed within this window. */
const TRADE_FRESH_MS = 5_000;
/** GT trades poll cadence per watcher (real volume, ~10-20s latency). */
const TRADES_POLL_MS = 8_000;
const MAX_SEEN_TRADES = 3_000;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let solUsdCache = 0;

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

// ── PumpPortal trade stream ──────────────────────────────────
const PUMPPORTAL_WS = process.env.PUMPPORTAL_WS_URL || 'wss://pumpportal.fun/api/data';

let ws: WebSocket | null = null;
let wsConnecting = false;
let wsBackoffMs = 2_000;
const subscribed = new Set<string>();

function wsSend(payload: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket died mid-send — reconnect handles it */
    }
  }
}

function subscribeMint(mint: string): void {
  if (subscribed.has(mint)) return;
  subscribed.add(mint);
  wsSend({ method: 'subscribeTokenTrade', keys: [mint] });
}

function unsubscribeMint(mint: string): void {
  if (!subscribed.delete(mint)) return;
  wsSend({ method: 'unsubscribeTokenTrade', keys: [mint] });
}

interface PumpTrade {
  mint?: string;
  txType?: string;
  solAmount?: number;
  tokenAmount?: number;
  [key: string]: unknown;
}

function handleTrade(msg: PumpTrade): void {
  const mint = msg.mint;
  if (!mint || (msg.txType !== 'buy' && msg.txType !== 'sell')) return;
  const w = watchers.get(mint);
  if (!w) return;
  const sol = Number(msg.solAmount);
  const tokens = Number(msg.tokenAmount);
  if (!(sol > 0) || !(tokens > 0) || solUsdCache <= 0) return;
  const priceUsd = (sol / tokens) * solUsdCache;
  const volumeUsd = sol * solUsdCache;
  w.lastTradeAt = Date.now();
  fold(w, Math.floor(Date.now() / 1000), priceUsd, volumeUsd);
}

function ensureStream(): void {
  if (ws || wsConnecting || typeof WebSocket === 'undefined') return;
  wsConnecting = true;
  try {
    const socket = new WebSocket(PUMPPORTAL_WS);
    socket.onopen = () => {
      wsConnecting = false;
      ws = socket;
      wsBackoffMs = 2_000;
      // (re)subscribe every active watcher after connect/reconnect
      const mints = [...watchers.keys()];
      subscribed.clear();
      for (const m of mints) subscribeMint(m);
      console.log(`[liveTicks] trade stream connected (${mints.length} mints)`);
    };
    socket.onmessage = (ev) => {
      try {
        handleTrade(JSON.parse(String(ev.data)) as PumpTrade);
      } catch {
        /* non-JSON keepalive — ignore */
      }
    };
    const reconnect = () => {
      if (ws === socket) ws = null;
      wsConnecting = false;
      subscribed.clear();
      if (watchers.size > 0) {
        setTimeout(ensureStream, wsBackoffMs).unref?.();
        wsBackoffMs = Math.min(wsBackoffMs * 2, 30_000);
      }
    };
    socket.onclose = reconnect;
    socket.onerror = () => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
    };
  } catch (err) {
    wsConnecting = false;
    console.warn('[liveTicks] trade stream unavailable:', err instanceof Error ? err.message.slice(0, 120) : err);
  }
}

// ── GeckoTerminal trades merge (real volume, slight latency) ─

/**
 * Merge a confirmed swap into the buffer at ITS OWN second — GT trades
 * arrive 10-20s behind the chain, so they usually land in buckets that
 * already exist. Volume adds up; high/low widen; close only moves for
 * the newest bucket so the live price stays authoritative.
 */
function mergeTrade(w: Watcher, ts: number, priceUsd: number, volumeUsd: number): void {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return;
  const cs = w.candles;
  const last = cs[cs.length - 1];
  if (!last || ts > last.timestamp) {
    fold(w, ts, priceUsd, volumeUsd);
    return;
  }
  // walk from the tail — trades are always recent
  for (let i = cs.length - 1; i >= 0 && cs[i].timestamp >= ts - 1; i--) {
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
  // older than the whole buffer — too stale to chart, drop
}

/** Poll GT for a watcher's recent trades and fold the unseen ones. */
async function pollTrades(w: Watcher): Promise<void> {
  try {
    // oldest-first so backfill builds the buffer in natural order
    const trades = (await fetchTrades(w.mint, 30)).sort((a, b) => a.blockUnixTime - b.blockUnixTime);
    for (const t of trades) {
      if (!t.txHash || w.seenTrades.has(t.txHash)) continue;
      w.seenTrades.add(t.txHash);
      if (w.seenTrades.size > MAX_SEEN_TRADES) {
        const oldest = w.seenTrades.values().next().value;
        if (oldest) w.seenTrades.delete(oldest);
      }
      mergeTrade(w, t.blockUnixTime, t.priceUsd, t.volumeUsd);
    }
  } catch {
    // GT hiccup — price polling still carries the tape
  }
}

// ── Jupiter poll (gap filler + seed + SOL/USD refresh) ───────

/** One tick: expire idle watchers, then price every active mint in ONE call. */
async function pollAll(): Promise<void> {
  if (polling) return; // never overlap slow polls
  polling = true;
  try {
    const now = Date.now();
    for (const [mint, w] of watchers) {
      if (now - w.lastAccess > IDLE_EXPIRE_MS) {
        watchers.delete(mint);
        unsubscribeMint(mint);
      }
    }
    if (watchers.size === 0) {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    ensureStream();
    solUsdCache = await getSolUsd().catch(() => solUsdCache);
    const prices = await getUsdPrices([...watchers.keys()]);
    const ts = Math.floor(Date.now() / 1000);
    const due: Promise<void>[] = [];
    for (const [mint, w] of watchers) {
      const p = prices.get(mint);
      // trades are authoritative — the poll only fills quiet stretches
      if (p && Date.now() - w.lastTradeAt > TRADE_FRESH_MS) {
        fold(w, ts, p.usdPrice, 0);
      }
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
}

/**
 * Get (or start) the live watcher for a mint. A new watcher is seeded
 * with a single bucket at the current price — no 1s history exists
 * anywhere, so pretending otherwise would be fakery. From that moment
 * on, every pump.fun trade streams in with real price + volume.
 */
export async function watchToken(mint: string): Promise<Watcher> {
  let w = watchers.get(mint);
  if (!w) {
    w = {
      mint,
      candles: [],
      lastPriceUsd: 0,
      lastAccess: Date.now(),
      lastTradeAt: 0,
      seenTrades: new Set(),
      lastTradesPoll: 0,
    };
    watchers.set(mint, w);
    ensureStream();
    subscribeMint(mint);
    // backfill from the last ~30 real swaps so the chart opens with
    // genuine recent history instead of a single dot
    w.lastTradesPoll = Date.now();
    await pollTrades(w);
    try {
      solUsdCache = await getSolUsd().catch(() => solUsdCache);
      const prices = await getUsdPrices([mint]);
      const p = prices.get(mint);
      if (p) fold(w, Math.floor(Date.now() / 1000), p.usdPrice, 0);
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
