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
// GeckoTerminal resolution floor is 1 minute — no seconds candles.

const INTERVAL_MAP: Record<string, string> = {
  '1': '1m', '5': '5m', '15': '15m',
  '60': '1H', '240': '4H', 'D': '1D',
};

// ─── OHLCV ──────────────────────────────────────────────────

export async function fetchOHLCV(
  tokenAddress: string,
  interval: string,
  _barCount = 300,
): Promise<OHLCVBar[]> {
  const type = INTERVAL_MAP[interval] || '1m';
  const candles = await getMarketPriceHistory(tokenAddress, type);
  return (candles ?? []).map((c) => ({
    time: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));
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

// ─── Price polling "stream" ─────────────────────────────────
// GeckoTerminal has no websocket. This polls the latest candles on a
// short interval and emits ticks; status is honestly 'polling'.

export type StreamStatus = 'connecting' | 'ws' | 'polling' | 'dead';

export interface StreamBar {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const POLL_MS = 10_000;
const MAX_FAILURES = 3;

export class PollingPriceStream {
  private timer: ReturnType<typeof setInterval> | null = null;
  private failures = 0;
  private stopped = false;

  constructor(
    private tokenAddress: string,
    private interval: string,
    private onTick: (price: number, timestamp: number, serverBar?: StreamBar) => void,
    private onStatus: (status: StreamStatus) => void,
  ) {}

  connect(): void {
    this.stopped = false;
    this.onStatus('connecting');
    const poll = async () => {
      if (this.stopped) return;
      try {
        const bars = await fetchOHLCV(this.tokenAddress, this.interval, 2);
        if (this.stopped) return;
        const last = bars[bars.length - 1];
        if (last && last.close > 0) {
          this.failures = 0;
          this.onStatus('polling');
          this.onTick(last.close, last.time, {
            o: last.open, h: last.high, l: last.low, c: last.close, v: last.volume,
          });
        }
      } catch {
        this.failures += 1;
        if (this.failures >= MAX_FAILURES) this.onStatus('dead');
      }
    };
    poll();
    this.timer = setInterval(poll, POLL_MS);
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
