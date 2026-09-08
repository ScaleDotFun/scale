// ──────────────────────────────────────────────
// LOADED PROTOCOL — Robinhood Chain market data (GeckoTerminal)
//
// Robinhood Chain is covered by GeckoTerminal's `robinhood` network — real pools,
// prices and OHLCV, no API key. This is the honest market-data source
// for the screener, token pages and charts now that the protocol
// targets Robinhood Chain and PONS launches.
//
// NOTE: addresses are hex and checksum case is NOT significant — always
// compare them case-insensitively against GT responses, which are lowercased.
// ──────────────────────────────────────────────

import { getEthUsd, getTrendingTokens, getTokenInfo, isLaunchpadToken, NATIVE_TOKEN, type TokenInfo } from '@loaded/evm';

// With a paid CoinGecko key the same GeckoTerminal endpoints are served
// from the Pro API at ~500 req/min (vs ~30 free) — identical paths and
// response shapes, just a different base + auth header.
function gtBase(): string {
  return (process.env.COINGECKO_API_KEY ?? '').trim()
    ? 'https://pro-api.coingecko.com/api/v3/onchain'
    : 'https://api.geckoterminal.com/api/v2';
}
function gtHeaders(): Record<string, string> {
  const key = (process.env.COINGECKO_API_KEY ?? '').trim();
  return key
    ? { Accept: 'application/json', 'x-cg-pro-api-key': key }
    : { Accept: 'application/json' };
}
export const GT_NETWORK = 'robinhood';

export interface MarketToken {
  address: string;
  name: string;
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  marketCap: number;
  liquidity: number;
  logoURI: string | null;
}

export interface OHLCVCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function gtFetch(path: string): Promise<any> {
  const res = await fetch(`${gtBase()}${path}`, { headers: gtHeaders() });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} on ${path}`);
  return res.json();
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * ETH/USD via LI.FI's price feed (60s cache + stale-if-error lives
 * inside getEthUsd). Returns 0 when no price is available so callers
 * degrade honestly instead of charting a wrong number.
 */
export async function fetchEthUsd(): Promise<number> {
  try {
    return await getEthUsd();
  } catch {
    return 0;
  }
}

/** Map an EVM-layer TokenInfo onto the MarketToken shape. */
function toMarketToken(t: TokenInfo): MarketToken {
  return {
    address: t.address,
    name: t.name ?? 'Unknown',
    symbol: t.symbol ?? '???',
    price: t.priceUsd ?? 0,
    priceChange24h: t.priceChange24h ?? 0,
    volume24h: t.volume24h ?? 0,
    marketCap: t.marketCap ?? 0,
    liquidity: t.liquidity ?? 0,
    logoURI: t.imageUri ?? null,
  };
}

/**
 * Trending launchpad coins on Robinhood Chain — one MarketToken per base token.
 *
 * A single page of trending pools yields only a handful of launchpad coins once
 * the venue filter is applied, which left the screener looking almost empty. We
 * aggregate several pages of both trending and general pools, dedupe by token,
 * and rank by 24h volume so the screener fills a real page.
 */
const TRENDING_PAGES = [
  'trending_pools?page=1',
  'trending_pools?page=2',
  'pools?page=1',
  'pools?page=2',
  'pools?page=3',
];

export async function fetchTrending(): Promise<MarketToken[]> {
  const out: MarketToken[] = [];
  const seen = new Set<string>();
  let anyPageLoaded = false;

  for (const path of TRENDING_PAGES) {
    let json: any;
    try {
      const sep = path.includes('?') ? '&' : '?';
      json = await gtFetch(`/networks/${GT_NETWORK}/${path}${sep}include=base_token`);
      anyPageLoaded = true;
    } catch {
      continue; // one bad page must not empty the whole screener
    }

    const included: Record<string, any> = {};
    for (const inc of json.included ?? []) included[inc.id] = inc.attributes;

    for (const pool of json.data ?? []) {
      const a = pool.attributes ?? {};
      const bt = included[pool.relationships?.base_token?.data?.id];
      const address = bt?.address ?? '';
      // GT lowercases addresses; dedupe on one casing.
      if (!address || seen.has(address.toLowerCase())) continue;

      // The venue identifies a launchpad coin — isLaunchpadToken is false for a
      // missing dex, so omitting it here would empty the whole screener.
      const dex = pool.relationships?.dex?.data?.id ?? null;
      if (!isLaunchpadToken(address, dex)) continue;

      const price = num(a.base_token_price_usd);
      const liquidity = num(a.reserve_in_usd);
      if (!(price > 0) || liquidity < 5_000) continue; // floor rug-dust

      seen.add(address.toLowerCase());
      out.push({
        address,
        name: bt?.name ?? 'Unknown',
        symbol: bt?.symbol ?? '???',
        price,
        priceChange24h: num(a.price_change_percentage?.h24),
        volume24h: num(a.volume_usd?.h24),
        marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
        liquidity,
        logoURI: bt?.image_url && bt.image_url !== 'missing.png' ? bt.image_url : null,
      });
    }
  }

  if (!anyPageLoaded) {
    // Every page failed — fall back to the EVM layer's own feed rather than
    // reporting an empty market.
    const fallback = await getTrendingTokens(50);
    return fallback
      .filter((t) => isLaunchpadToken(t.address, t.launchpad))
      .filter((t) => (t.priceUsd ?? 0) > 0 && (t.liquidity ?? 0) >= 5_000)
      .slice(0, 60)
      .map(toMarketToken);
  }

  // Most-traded first — a screener sorted by activity, not by page order.
  out.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0));
  return out.slice(0, 60);
}

/**
 * Freshly launched coins on Robinhood Chain, newest first.
 *
 * This is the Explorer's feed: coins that just came off a launchpad, which is
 * a different question from the screener's "what is being traded most". Only
 * launchpad venues count — a new Uniswap pool for an established token is not
 * a launch.
 */
export interface NewLaunch extends MarketToken {
  /** ISO timestamp the pool was created. */
  createdAt: string | null;
  /** Launch venue, e.g. "pons-v2". */
  dex: string | null;
}

export async function fetchNewLaunches(): Promise<NewLaunch[]> {
  const out: NewLaunch[] = [];
  const seen = new Set<string>();

  for (const page of [1, 2]) {
    let json: any;
    try {
      json = await gtFetch(`/networks/${GT_NETWORK}/new_pools?include=base_token&page=${page}`);
    } catch {
      continue;
    }
    const included: Record<string, any> = {};
    for (const inc of json.included ?? []) included[inc.id] = inc.attributes;

    for (const pool of json.data ?? []) {
      const a = pool.attributes ?? {};
      const bt = included[pool.relationships?.base_token?.data?.id];
      const address = bt?.address ?? '';
      if (!address || seen.has(address.toLowerCase())) continue;

      const dex = pool.relationships?.dex?.data?.id ?? null;
      if (!isLaunchpadToken(address, dex)) continue; // launches only

      seen.add(address.toLowerCase());
      out.push({
        address,
        name: bt?.name ?? 'Unknown',
        symbol: bt?.symbol ?? '???',
        price: num(a.base_token_price_usd),
        priceChange24h: num(a.price_change_percentage?.h24),
        volume24h: num(a.volume_usd?.h24),
        marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
        liquidity: num(a.reserve_in_usd),
        logoURI: bt?.image_url && bt.image_url !== 'missing.png' ? bt.image_url : null,
        createdAt: a.pool_created_at ?? null,
        dex,
      });
    }
  }

  out.sort((x, y) => new Date(y.createdAt ?? 0).getTime() - new Date(x.createdAt ?? 0).getTime());
  return out.slice(0, 60);
}

/**
 * Single token overview on Robinhood Chain.
 * GeckoTerminal first; the EVM layer's token lookup as fallback when GT is
 * rate-limited or doesn't know the token yet (fresh PONS launches).
 */
export async function fetchToken(address: string): Promise<MarketToken & { supply: number }> {
  let json: any;
  try {
    json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${address}?include=top_pools`);
  } catch (gtErr) {
    const fallback = await getTokenInfo(address).catch(() => null);
    if (!fallback) throw gtErr;
    return {
      ...toMarketToken(fallback),
      supply: 0, // total supply is not part of the market feed; read on-chain when needed
    };
  }
  const a = json.data?.attributes ?? {};
  const topPool = (json.included ?? [])[0]?.attributes ?? {};
  return {
    address: a.address ?? address,
    name: a.name ?? 'Unknown',
    symbol: a.symbol ?? '???',
    price: num(a.price_usd),
    priceChange24h: num(topPool.price_change_percentage?.h24),
    volume24h: num(a.volume_usd?.h24) || num(topPool.volume_usd?.h24),
    marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
    liquidity: num(a.total_reserve_in_usd) || num(topPool.reserve_in_usd),
    logoURI: a.image_url && a.image_url !== 'missing.png' ? a.image_url : null,
    // ERC-20s on Robinhood Chain are 18 decimals unless stated otherwise
    supply: num(a.total_supply) / Math.pow(10, num(a.decimals) || 18),
  };
}

/** Resolve a token's highest-liquidity pool (cached) for OHLCV lookups. */
const poolCache = new Map<string, { pool: string; at: number }>();
export async function topPoolFor(address: string): Promise<string | null> {
  const cached = poolCache.get(address);
  if (cached && Date.now() - cached.at < 300_000) return cached.pool;
  const json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${address}/pools?page=1`);
  const pools = (json.data ?? [])
    .map((p: any) => ({ addr: p.attributes?.address, liq: num(p.attributes?.reserve_in_usd) }))
    .filter((p: any) => p.addr)
    .sort((x: any, y: any) => y.liq - x.liq);
  const pool = pools[0]?.addr ?? null;
  if (pool) poolCache.set(address, { pool, at: Date.now() });
  return pool;
}

/** Map our chart interval to GeckoTerminal timeframe + aggregate. */
function gtTimeframe(type: string): { tf: string; agg: number } {
  switch (type) {
    case '1m': case '1': return { tf: 'minute', agg: 1 };
    case '5m': case '5': return { tf: 'minute', agg: 5 };
    case '15m': case '15': return { tf: 'minute', agg: 15 };
    case '1H': case '60': return { tf: 'hour', agg: 1 };
    case '4H': case '240': return { tf: 'hour', agg: 4 };
    case '1D': case 'D': return { tf: 'day', agg: 1 };
    default: return { tf: 'hour', agg: 1 };
  }
}

/** OHLCV candles for a token (resolved via its top pool). */
export async function fetchOHLCV(
  address: string,
  type: string,
  beforeTs?: number,
  limit = 300,
): Promise<OHLCVCandle[]> {
  const pool = await topPoolFor(address);
  if (!pool) return [];
  const { tf, agg } = gtTimeframe(type);
  const params = new URLSearchParams({ aggregate: String(agg), limit: String(Math.min(limit, 1000)) });
  if (beforeTs) params.set('before_timestamp', String(beforeTs));
  const json = await gtFetch(`/networks/${GT_NETWORK}/pools/${pool}/ohlcv/${tf}?${params.toString()}`);
  const list: number[][] = json.data?.attributes?.ohlcv_list ?? [];
  // GT returns newest-first; charts want ascending time
  return list
    .map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .filter((c) => c.timestamp > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}


export interface PoolTrade {
  txHash: string;
  blockUnixTime: number;
  side: 'buy' | 'sell';
  tokenAmount: number;
  priceUsd: number;
  volumeUsd: number;
  owner: string;
}

/** Recent trades for a token's top pool — real swaps from GeckoTerminal. */
export async function fetchTrades(address: string, limit = 30): Promise<PoolTrade[]> {
  const pool = await topPoolFor(address);
  if (!pool) return [];
  const json = await gtFetch(`/networks/${GT_NETWORK}/pools/${pool}/trades`);
  return (json.data ?? [])
    .map((t: any) => {
      const a = t.attributes ?? {};
      const isBuy = a.kind === 'buy';
      // amount + price: whichever side of the swap is OUR token —
      // the other side is ETH/USDC and would show the quote price instead
      // GT returns lowercased addresses while route params are often
      // checksummed — a case-sensitive compare picks the WRONG side and
      // charts the quote asset instead of the token.
      const ourTokenIsTo =
        (a.to_token_address ?? '').toLowerCase() === address.toLowerCase();
      const tokenAmount = ourTokenIsTo ? num(a.to_token_amount) : num(a.from_token_amount);
      const priceUsd = ourTokenIsTo ? num(a.price_to_in_usd) : num(a.price_from_in_usd);
      return {
        txHash: a.tx_hash ?? '',
        blockUnixTime: Math.floor(new Date(a.block_timestamp ?? 0).getTime() / 1000),
        side: (isBuy ? 'buy' : 'sell') as 'buy' | 'sell',
        tokenAmount,
        priceUsd,
        volumeUsd: num(a.volume_in_usd),
        owner: a.tx_from_address ?? '',
      };
    })
    .filter((t: PoolTrade) => t.txHash && t.blockUnixTime > 0)
    .slice(0, limit);
}

export interface ReferenceFeed {
  /** Human label for what the candles actually are, e.g. "ETH/USD" */
  label: string;
  candles: OHLCVCandle[];
}

/**
 * OHLCV for the hero "market wall" — wrapped ETH's deepest pool on
 * Robinhood Chain (always a real, liquid market to draw), newest ascending.
 * GT OHLCV closes are quoted in USD, so the feed reads as ETH/USD.
 */
/**
 * Top WETH pool where WETH is the BASE token — GT pool OHLCV is quoted
 * in base-token USD, so a pool with WETH as quote would chart the other
 * asset's price under a "ETH/USD" label.
 */
let _refPool: { pool: string; at: number } | null = null;
async function referencePoolFor(): Promise<string | null> {
  if (_refPool && Date.now() - _refPool.at < 300_000) return _refPool.pool;
  const json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${NATIVE_TOKEN}/pools?page=1`);
  const pools = (json.data ?? [])
    .filter((p: any) => (p.relationships?.base_token?.data?.id ?? '').endsWith(`_${NATIVE_TOKEN}`))
    .map((p: any) => ({ addr: p.attributes?.address, liq: num(p.attributes?.reserve_in_usd) }))
    .filter((p: any) => p.addr)
    .sort((x: any, y: any) => y.liq - x.liq);
  const pool = pools[0]?.addr ?? null;
  if (pool) _refPool = { pool, at: Date.now() };
  return pool;
}

export async function fetchReferenceOHLCV(type: string, limit = 96): Promise<ReferenceFeed> {
  const pool = await referencePoolFor();
  if (!pool) return { label: '', candles: [] };
  const { tf, agg } = gtTimeframe(type);
  const j = await gtFetch(`/networks/${GT_NETWORK}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`);
  const list: number[][] = j.data?.attributes?.ohlcv_list ?? [];
  const candles = list
    .map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .filter((c) => c.timestamp > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Sanity: the feed must actually track ETH/USD. If the last close is
  // >25% off LI.FI's spot, the pool is mis-oriented — serve nothing
  // rather than a wrong chart (the UI shows an honest NO FEED state).
  const last = candles[candles.length - 1]?.close ?? 0;
  const ethUsd = await fetchEthUsd();
  if (last > 0 && ethUsd > 0 && Math.abs(last - ethUsd) / ethUsd > 0.25) {
    return { label: '', candles: [] };
  }
  return { label: 'ETH/USD', candles };
}

/** Search Robinhood Chain pools by symbol/name (best-effort via pools search). */
export async function searchTokens(query: string): Promise<MarketToken[]> {
  const json = await gtFetch(`/search/pools?query=${encodeURIComponent(query)}&network=${GT_NETWORK}&include=base_token`);
  const included: Record<string, any> = {};
  for (const inc of json.included ?? []) included[inc.id] = inc.attributes;
  const out: MarketToken[] = [];
  const seen = new Set<string>();
  for (const pool of json.data ?? []) {
    const a = pool.attributes ?? {};
    const bt = included[pool.relationships?.base_token?.data?.id ?? ''] ?? null;
    const address = bt?.address ?? '';
    // GT returns lowercased addresses; the top-up feed returns checksummed
    // ones. Dedupe on a single casing or the same coin lands in the list twice.
    if (!address || seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    // The venue identifies a launchpad coin — isLaunchpadToken is false for a
    // missing dex, so omitting it here would empty the whole screener.
    const dex = pool.relationships?.dex?.data?.id ?? null;
    if (!isLaunchpadToken(address, dex)) continue; // launchpad coins only
    out.push({
      address,
      name: bt?.name ?? 'Unknown',
      symbol: bt?.symbol ?? '???',
      price: num(a.base_token_price_usd),
      priceChange24h: num(a.price_change_percentage?.h24),
      volume24h: num(a.volume_usd?.h24),
      marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
      liquidity: num(a.reserve_in_usd),
      logoURI: bt?.image_url && bt.image_url !== 'missing.png' ? bt.image_url : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}
