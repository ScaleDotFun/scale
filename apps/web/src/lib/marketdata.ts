// ──────────────────────────────────────────────
// SCALE PROTOCOL — Robinhood Chain market data client
//
// All data flows through our API (GeckoTerminal-backed) — no client
// API keys, no Birdeye. GeckoTerminal has no websocket, so "live" is
// honest polling: the stream badge shows POLL, never a fake LIVE.
// ──────────────────────────────────────────────

import {
  getMarketToken,
  getMarketPriceHistory,
  getMarketTrades,
  getMarketPool,
  getLiveHistory,
  type MarketTrade,
} from './api';

// ─── Types (shapes kept from the old birdeye client) ────────

export interface OHLCVBar {
  time: number;   // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange24h: number;
  priceChange1h: number;
  volume24h: number;
  volume24hChange: number;
  marketCap: number;
  liquidity: number;
  supply: number;
  holder: number;
  trade24h: number;
  trade24hChange: number;
  buy24h: number;
  sell24h: number;
  uniqueWallet24h: number;
  uniqueWallet24hChange: number;
  lastTradeUnixTime: number;
  creationTime?: number;
  logoURI?: string;
}

export type TradeItem = MarketTrade;

// ─── Interval map: our keys → API `type` param ──────────────
// Minute+ frames come from GeckoTerminal; seconds frames are decoded
// live from Uniswap V3 Swap events on-chain (see /live-history).

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m', '5': '5m', '15': '15m',
  '60': '1H', '240': '4H', 'D': '1D',
};

const SECONDS_FRAMES: Record<string, '1s' | '5s' | '15s'> = {
  '1S': '1s', '5S': '5s', '15S': '15s',
};

// ─── OHLCV ──────────────────────────────────────────────────

const toBars = (candles: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[]): OHLCVBar[] =>
  (candles ?? []).map((c) => ({
    time: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

export async function fetchOHLCV(
  tokenAddress: string,
  interval: string,
  barCount = 300,
): Promise<OHLCVBar[]> {
  const sec = SECONDS_FRAMES[interval];
  if (sec) {
    const { candles } = await getLiveHistory(tokenAddress, sec, barCount);
    return toBars(candles);
  }
  const type = INTERVAL_MAP[interval] || '1m';
  const candles = await getMarketPriceHistory(tokenAddress, type);
  return toBars(candles);
}

/** Older candles for scroll-back pagination (minute+ frames only). */
export async function fetchOlderOHLCV(
  tokenAddress: string,
  interval: string,
  beforeTs: number,
): Promise<OHLCVBar[]> {
  if (SECONDS_FRAMES[interval]) return []; // live buffer has no deep history
  const type = INTERVAL_MAP[interval] || '1m';
  const candles = await getMarketPriceHistory(tokenAddress, type, undefined, beforeTs);
  return toBars(candles).filter((b) => b.time < beforeTs);
}

// ─── Token overview ─────────────────────────────────────────

export async function fetchTokenOverview(tokenAddress: string): Promise<TokenOverview | null> {
  try {
    const t = await getMarketToken(tokenAddress);
    return {
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: 18,
      price: t.price,
      priceChange24h: t.priceChange24h,
      priceChange1h: 0,
      volume24h: t.volume24h,
      volume24hChange: 0,
      marketCap: t.marketCap,
      liquidity: t.liquidity,
      supply: t.supply,
      holder: t.holders ?? 0,
      trade24h: 0,
      trade24hChange: 0,
      buy24h: 0,
      sell24h: 0,
      uniqueWallet24h: 0,
      uniqueWallet24hChange: 0,
      lastTradeUnixTime: 0,
      logoURI: t.logoURI ?? undefined,
    };
  } catch {
    return null;
  }
}

// ─── Trades ─────────────────────────────────────────────────

export async function fetchRecentTrades(tokenAddress: string, limit = 20): Promise<TradeItem[]> {
  try {
    return await getMarketTrades(tokenAddress, limit);
  } catch {
    return [];
  }
}

// ─── Top pool (for the GeckoTerminal chart embed) ───────────

const poolCache = new Map<string, string | null>();
export async function fetchTopPool(tokenAddress: string): Promise<string | null> {
  if (poolCache.has(tokenAddress)) return poolCache.get(tokenAddress) ?? null;
  try {
    const { pool } = await getMarketPool(tokenAddress);
    poolCache.set(tokenAddress, pool);
    return pool;
  } catch {
    return null;
  }
}

// ─── Live price stream ──────────────────────────────────────
// Ticks come from the on-chain live engine (real Uniswap V3 swaps,
// ~1.2s cadence server-side) — status 'ws' = genuinely live data.
// If the live engine is unreachable, minute+ frames fall back to
// GeckoTerminal bar polling with an honest 'polling' badge.

export type StreamStatus = 'connecting' | 'ws' | 'polling' | 'dead';

export interface StreamBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const LIVE_POLL_MS = 1_500;
const GT_POLL_MS = 10_000;
const MAX_FAILURES = 3;

export class PollingPriceStream {
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopped = false;
  private gtFallback = false;

  constructor(
    private tokenAddress: string,
    private interval: string,
    private onTick: (price: number, timestamp: number, serverBar?: StreamBar) => void,
    private onStatus: (status: StreamStatus) => void,
  ) {}

  connect(): void {
    this.stopped = false;
    this.onStatus('connecting');
    const sec = SECONDS_FRAMES[this.interval];

    const liveTick = async () => {
      if (this.stopped) return;
      try {
        const { candles, last } = await getLiveHistory(this.tokenAddress, sec ?? '1s', 2);
        if (this.stopped) return;
        this.failures = 0;
        this.onStatus('ws'); // real on-chain swaps — genuinely live
        const bar = candles[candles.length - 1];
        if (sec && bar) {
          // seconds frames: adopt the authoritative live bar
          this.onTick(last || bar.close, bar.timestamp, {
            o: bar.open, h: bar.high, l: bar.low, c: bar.close, v: bar.volume,
          });
        } else if (last > 0) {
          // minute+ frames: per-swap price ticks move the current GT bar
          this.onTick(last, Math.floor(Date.now() / 1000));
        }
      } catch {
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) {
          if (sec) {
            this.onStatus('dead'); // seconds data only exists on-chain
          } else {
            this.switchToGtFallback();
          }
        }
      }
    };

    this.timer = setInterval(liveTick, LIVE_POLL_MS);
    liveTick();
  }

  /** Minute+ frames degrade to GT bar polling when the live engine is down. */
  private switchToGtFallback(): void {
    if (this.gtFallback || this.stopped) return;
    this.gtFallback = true;
    if (this.timer) clearInterval(this.timer);
    const poll = async () => {
      if (this.stopped) return;
      try {
        const bars = await fetchOHLCV(this.tokenAddress, this.interval, 2);
        const lastBar = bars[bars.length - 1];
        if (lastBar && lastBar.close > 0) {
          this.onStatus('polling');
          this.onTick(lastBar.close, lastBar.time, {
            o: lastBar.open, h: lastBar.high, l: lastBar.low, c: lastBar.close, v: lastBar.volume,
          });
        }
      } catch {
        this.onStatus('dead');
      }
    };
    poll();
    this.timer = setInterval(poll, GT_POLL_MS);
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
