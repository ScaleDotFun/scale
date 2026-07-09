/**
 * Birdeye API service — powers real-time charts + token intelligence.
 *
 * REST:
 *   - OHLCV historical candles (V1 for 1m+, V3 for sub-minute)
 *   - Token overview (price, mcap, liquidity, volume, holder count)
 *   - Token security (mint authority, freeze authority)
 *   - Token trades (recent transactions)
 *   - Token price history
 *
 * WebSocket:
 *   - Live price streaming with OHLCV candle construction
 *   - Ping-pong keepalive
 *
 * Requires VITE_BIRDEYE_API_KEY in .env (Business plan for WebSocket)
 */

const API_BASE = 'https://public-api.birdeye.so';
const WS_URL_FALLBACK = 'wss://public-api.birdeye.so/socket/solana';
const BACKEND_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/+$/, '').replace(/\/api$/, '')}/api`
  : '/api';

function getApiKey(): string {
  return import.meta.env.VITE_BIRDEYE_API_KEY || '';
}

// ─── Types ──────────────────────────────────────────────────

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

export interface TokenSecurity {
  creatorAddress: string;
  ownerAddress: string;
  creationTx: string;
  creationTime: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isToken2022: boolean;
  isTrueToken: boolean;
  totalSupply: number;
  top10HolderPercent: number;
  top10HolderBalance: number;
  metaplexUpdateAuthority: string;
  metaplexOwnerUpdateAuthority: string;
}

export interface TradeItem {
  txHash: string;
  blockUnixTime: number;
  source: string;
  owner: string;
  side: 'buy' | 'sell';
  tokenAmount: number;
  priceUsd: number;
  volumeUsd: number;
}

// ─── Interval Maps ──────────────────────────────────────────

/** Map our interval strings to Birdeye's `type` parameter */
const INTERVAL_MAP: Record<string, string> = {
  '1S':  '1s',
  '5S':  '5s',
  '15S': '15s',
  '30S': '30s',
  '1':   '1m',
  '3':   '3m',
  '5':   '5m',
  '15':  '15m',
  '30':  '30m',
  '60':  '1H',
  '240': '4H',
  'D':   '1D',
};

/** Duration in seconds for each interval — used to calculate time_from */
const INTERVAL_SECS: Record<string, number> = {
  '1S': 1,    '5S': 5,   '15S': 15,  '30S': 30,
  '1': 60,    '3': 180,  '5': 300,   '15': 900,
  '30': 1800, '60': 3600, '240': 14400, 'D': 86400,
};

// ─── REST: OHLCV ────────────────────────────────────────────

/**
 * Fetch historical OHLCV data from Birdeye REST API.
 * Uses V3 endpoint for sub-minute candles (1s, 5s, 15s, 30s).
 * Uses V1 endpoint for minute+ candles.
 */
export async function fetchOHLCV(
  tokenAddress: string,
  interval: string,
  barCount = 300,
): Promise<OHLCVBar[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[Birdeye] No API key — returning empty data');
    return [];
  }

  const type = INTERVAL_MAP[interval] || '1m';
  const intervalSecs = INTERVAL_SECS[interval] || 60;
  const now = Math.floor(Date.now() / 1000);
  const timeFrom = now - (barCount * intervalSecs);

  // V3 supports sub-minute candles; V1 only 1m+
  const isSubMinute = ['1S', '5S', '15S', '30S'].includes(interval);
  const endpoint = isSubMinute ? 'defi/v3/ohlcv' : 'defi/ohlcv';
  const url = `${API_BASE}/${endpoint}?address=${tokenAddress}&type=${type}&time_from=${timeFrom}&time_to=${now}`;

  try {
    const res = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
        'x-chain': 'solana',
      },
    });

    if (!res.ok) {
      console.error(`[Birdeye] OHLCV fetch failed: ${res.status}`);
      return [];
    }

    const json = await res.json();
    const items = json.data?.items || [];

    const bars: OHLCVBar[] = items
      .map((item: any) => ({
        time: Math.floor(item.unixTime ?? item.unix_time ?? 0),
        open: Number(item.o),
        high: Number(item.h),
        low: Number(item.l),
        close: Number(item.c),
        volume: Number(item.v ?? item.volume ?? 0) || 0,
      }))
      .filter((b: OHLCVBar) =>
        b.time > 0 &&
        Number.isFinite(b.open) && b.open > 0 &&
        Number.isFinite(b.high) && b.high > 0 &&
        Number.isFinite(b.low) && b.low > 0 &&
        Number.isFinite(b.close) && b.close > 0,
      );

    // lightweight-charts requires strictly ascending, unique times
    bars.sort((a, b) => a.time - b.time);
    const deduped: OHLCVBar[] = [];
    for (const b of bars) {
      const prev = deduped[deduped.length - 1];
      if (prev && prev.time === b.time) deduped[deduped.length - 1] = b;
      else deduped.push(b);
    }
    return deduped;
  } catch (err) {
    console.error('[Birdeye] OHLCV fetch error:', err);
    return [];
  }
}

// ─── REST: Token Overview ───────────────────────────────────

/**
 * Fetch comprehensive token overview data.
 * Includes price, mcap, liquidity, volume, holder count, trade count.
 */
export async function fetchTokenOverview(tokenAddress: string): Promise<TokenOverview | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/defi/token_overview?address=${tokenAddress}`, {
      headers: {
        'X-API-KEY': apiKey,
        'x-chain': 'solana',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;

    return {
      address: d.address || tokenAddress,
      symbol: d.symbol || '',
      name: d.name || '',
      decimals: d.decimals || 0,
      price: d.price ?? d.v24hUSD ?? 0,
      priceChange24h: d.priceChange24hPercent ?? 0,
      priceChange1h: d.priceChange1hPercent ?? 0,
      volume24h: d.v24hUSD ?? d.volume24h ?? 0,
      volume24hChange: d.v24hChangePercent ?? 0,
      marketCap: d.marketCap ?? d.mc ?? d.realMc ?? 0,
      liquidity: d.liquidity ?? 0,
      supply: d.supply ?? d.circulatingSupply ?? d.totalSupply ?? 0,
      holder: d.holder ?? 0,
      trade24h: d.trade24h ?? 0,
      trade24hChange: d.trade24hChangePercent ?? 0,
      buy24h: d.buy24h ?? 0,
      sell24h: d.sell24h ?? 0,
      uniqueWallet24h: d.uniqueWallet24h ?? 0,
      uniqueWallet24hChange: d.uniqueWallet24hChangePercent ?? 0,
      lastTradeUnixTime: d.lastTradeUnixTime ?? 0,
      creationTime: d.creationTime,
      logoURI: d.logoURI ?? d.icon,
    };
  } catch {
    return null;
  }
}

// ─── REST: Token Security ───────────────────────────────────

/**
 * Fetch token security info — mint authority, freeze authority, top holders.
 */
export async function fetchTokenSecurity(tokenAddress: string): Promise<TokenSecurity | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/defi/token_security?address=${tokenAddress}`, {
      headers: {
        'X-API-KEY': apiKey,
        'x-chain': 'solana',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d = json.data;
    if (!d) return null;

    return {
      creatorAddress: d.creatorAddress ?? '',
      ownerAddress: d.ownerAddress ?? '',
      creationTx: d.creationTx ?? '',
      creationTime: d.creationTime ?? 0,
      mintAuthority: d.mintAuthority ?? null,
      freezeAuthority: d.freezeAuthority ?? null,
      isToken2022: d.isToken2022 ?? false,
      isTrueToken: d.isTrueToken ?? false,
      totalSupply: d.totalSupply ?? 0,
      top10HolderPercent: d.top10HolderPercent ?? 0,
      top10HolderBalance: d.top10HolderBalance ?? 0,
      metaplexUpdateAuthority: d.metaplexUpdateAuthority ?? '',
      metaplexOwnerUpdateAuthority: d.metaplexOwnerUpdateAuthority ?? '',
    };
  } catch {
    return null;
  }
}

// ─── REST: Recent Trades ────────────────────────────────────

/**
 * Fetch recent trades for a token.
 */
export async function fetchRecentTrades(tokenAddress: string, limit = 20): Promise<TradeItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) return [];

  try {
    const res = await fetch(`${API_BASE}/defi/txs/token?address=${tokenAddress}&tx_type=swap&sort_type=desc&limit=${limit}`, {
      headers: {
        'X-API-KEY': apiKey,
        'x-chain': 'solana',
      },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const items = json.data?.items || [];

    return items.map((item: any) => ({
      txHash: item.txHash ?? '',
      blockUnixTime: item.blockUnixTime ?? 0,
      source: item.source ?? '',
      owner: item.owner ?? '',
      side: item.side ?? 'buy',
      tokenAmount: Math.abs(item.from?.amount ?? 0),
      priceUsd: item.from?.nearestPrice ?? item.to?.nearestPrice ?? 0,
      volumeUsd: Math.abs(item.volumeUSD ?? 0),
    }));
  } catch {
    return [];
  }
}

// ─── REST: Price ────────────────────────────────────────────

/**
 * Fetch current token price from Birdeye.
 */
export async function fetchPrice(tokenAddress: string): Promise<number | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch(`${API_BASE}/defi/price?address=${tokenAddress}`, {
      headers: {
        'X-API-KEY': apiKey,
        'x-chain': 'solana',
      },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.value ?? null;
  } catch {
    return null;
  }
}

// ─── WebSocket: Live Price Stream ───────────────────────────

/**
 * WebSocket price stream for real-time candle updates.
 * Subscribes with correct chartType matching the selected interval.
 * Implements ping-pong keepalive per Birdeye best practices.
 */
export type StreamStatus = 'connecting' | 'ws' | 'polling' | 'dead';

export class BirdeyePriceStream {
  private ws: WebSocket | null = null;
  private tokenAddress: string;
  private chartType: string;
  private onUpdate: (price: number, timestamp: number) => void;
  private onStatus?: (status: StreamStatus) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private alive = true;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(
    tokenAddress: string,
    chartType: string,
    onUpdate: (price: number, timestamp: number) => void,
    onStatus?: (status: StreamStatus) => void,
  ) {
    this.tokenAddress = tokenAddress;
    this.chartType = chartType;
    this.onUpdate = onUpdate;
    this.onStatus = onStatus;
  }

  private setStatus(s: StreamStatus) {
    if (this.alive) this.onStatus?.(s);
  }

  async connect() {
    this.setStatus('connecting');
    // Try to get WS URL from backend (keeps API key server-side)
    let wsUrl: string;
    try {
      const res = await fetch(`${BACKEND_URL}/market/ws-config`);
      if (res.ok) {
        const json = await res.json();
        wsUrl = json.data?.wsUrl;
      } else {
        throw new Error('WS config unavailable');
      }
    } catch {
      // Fallback: use client-side key if backend is unavailable
      const apiKey = getApiKey();
      if (!apiKey) {
        console.warn('[Birdeye WS] No API key — using polling fallback');
        this.startPolling();
        return;
      }
      wsUrl = `${WS_URL_FALLBACK}?x-api-key=${apiKey}`;
    }

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('ws');

        // Subscribe to token price updates with correct chartType
        this.ws?.send(JSON.stringify({
          type: 'SUBSCRIBE_PRICE',
          data: {
            queryType: 'simple',
            chartType: this.chartType,
            address: this.tokenAddress,
            currency: 'usd',
          },
        }));

        // Start ping-pong keepalive (every 25 seconds)
        this.pingTimer = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 25000);
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          // Handle PONG
          if (msg.type === 'PONG') return;

          // Handle price data
          if (msg.type === 'PRICE_DATA' && msg.data) {
            const d = msg.data;
            // The WS sends OHLCV candle data
            const price = d.c ?? d.close ?? d.value ?? d.price;
            const timestamp = d.unixTime ?? d.unix_time ?? Math.floor(Date.now() / 1000);
            if (price && typeof price === 'number') {
              this.onUpdate(price, timestamp);
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      this.ws.onclose = () => {
        this.clearPing();
        if (!this.alive) return;
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 10000);
          this.setStatus('connecting');
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        } else {
          this.startPolling();
        }
      };

      this.ws.onerror = () => {
        this.ws?.close();
      };
    } catch {
      // WebSocket failed, fall back to polling
      this.startPolling();
    }
  }

  private clearPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /** Polling fallback — fetches price every second */
  private pollingId: ReturnType<typeof setInterval> | null = null;

  private startPolling() {
    if (this.pollingId) return; // never double-poll
    this.setStatus('polling');
    // Gentler than before: 2s floor, and skip entirely while the tab is hidden
    const intervalMs = this.chartType === '1s' ? 2000 : 5000;
    let inFlight = false;
    this.pollingId = setInterval(async () => {
      if (!this.alive || inFlight || document.hidden) return;
      inFlight = true;
      try {
        const price = await fetchPrice(this.tokenAddress);
        if (price !== null && this.alive) {
          this.onUpdate(price, Math.floor(Date.now() / 1000));
        }
      } finally {
        inFlight = false;
      }
    }, intervalMs);
  }

  disconnect() {
    this.alive = false;
    this.clearPing();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pollingId) clearInterval(this.pollingId);
    this.ws?.close();
    this.ws = null;
  }
}
