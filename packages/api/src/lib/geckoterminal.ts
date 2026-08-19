// ──────────────────────────────────────────────
// SCALE PROTOCOL — Solana market data (GeckoTerminal)
//
// Solana is covered by GeckoTerminal's `solana` network — real pools,
// prices and OHLCV, no API key. This is the honest market-data source
// for the screener, token pages and charts now that the protocol
// targets Solana and pump.fun launches.
//
// NOTE: Solana mints are base58 and CASE-SENSITIVE — never lowercase
// an address before handing it to a GT endpoint or comparing it.
// ──────────────────────────────────────────────

import { getSolUsd, getTrendingTokens, getJupToken, isPumpFunToken, WSOL_MINT, type JupTokenInfo } from '@scale/solana';

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
export const GT_NETWORK = 'solana';

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
 * SOL/USD via Jupiter's price feed (60s cache + stale-if-error lives
 * inside getSolUsd). Returns 0 when no price is available so callers
 * degrade honestly instead of charting a wrong number.
 */
export async function fetchSolUsd(): Promise<number> {
  try {
    return await getSolUsd();
  } catch {
    return 0;
  }
}

/** Map a Jupiter token-registry entry onto the MarketToken shape. */
function jupToMarketToken(t: JupTokenInfo): MarketToken {
  return {
    address: t.id,
    name: t.name ?? 'Unknown',
    symbol: t.symbol ?? '???',
    price: t.usdPrice ?? 0,
    priceChange24h: t.stats24h?.priceChange ?? 0,
    volume24h: (t.stats24h?.buyVolume ?? 0) + (t.stats24h?.sellVolume ?? 0),
    marketCap: t.mcap ?? t.fdv ?? 0,
    liquidity: t.liquidity ?? 0,
    logoURI: t.icon ?? null,
  };
}

/**
 * Trending on Solana → one MarketToken per base token, pump.fun coins
 * ONLY (SCALE lists nothing else, so the screener shows nothing else).
 * GeckoTerminal first; Jupiter's trending feed as fallback (GT's free
 * tier rate-limits aggressively and Jupiter carries the same fields).
 */
export async function fetchTrending(): Promise<MarketToken[]> {
  let json: any;
  try {
    json = await gtFetch(`/networks/${GT_NETWORK}/trending_pools?include=base_token&page=1`);
  } catch (gtErr) {
    const jup = await getTrendingTokens('24h');
    const out = jup
      .filter((t) => isPumpFunToken(t.id, t.launchpad))
      .filter((t) => (t.usdPrice ?? 0) > 0 && (t.liquidity ?? 0) >= 5_000)
      .slice(0, 20)
      .map(jupToMarketToken);
    if (out.length === 0) throw gtErr; // both sources dry — surface the original error
    return out;
  }
  const included: Record<string, any> = {};
  for (const inc of json.included ?? []) included[inc.id] = inc.attributes;

  const out: MarketToken[] = [];
  const seen = new Set<string>();
  for (const pool of json.data ?? []) {
    const a = pool.attributes ?? {};
    const btId = pool.relationships?.base_token?.data?.id;
    const bt = btId ? included[btId] : null;
    const address = bt?.address ?? '';
    if (!address || seen.has(address)) continue;
    seen.add(address);
    if (!isPumpFunToken(address)) continue; // pump.fun coins only

    const price = num(a.base_token_price_usd);
    const liquidity = num(a.reserve_in_usd);
    if (!(price > 0) || liquidity < 5_000) continue; // floor rug-dust

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
    if (out.length >= 20) break;
  }

  // GT trending skews to majors; after the pump.fun filter it can run
  // thin. Top up from Jupiter's trending feed so the screener stays full.
  if (out.length < 12) {
    try {
      const jup = await getTrendingTokens('24h');
      for (const t of jup) {
        if (out.length >= 20) break;
        if (seen.has(t.id) || out.some((m) => m.address === t.id)) continue;
        if (!isPumpFunToken(t.id, t.launchpad)) continue;
        if (!((t.usdPrice ?? 0) > 0) || (t.liquidity ?? 0) < 5_000) continue;
        out.push(jupToMarketToken(t));
      }
    } catch {
      // top-up is best-effort — GT results alone are still valid
    }
  }
  return out;
}

/**
 * Single token overview on Solana.
 * GeckoTerminal first; Jupiter's registry as fallback when GT is
 * rate-limited or doesn't know the token yet (fresh pump.fun launches).
 */
export async function fetchToken(address: string): Promise<MarketToken & { supply: number }> {
  let json: any;
  try {
    json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${address}?include=top_pools`);
  } catch (gtErr) {
    const jup = await getJupToken(address).catch(() => null);
    if (!jup) throw gtErr;
    return {
      ...jupToMarketToken(jup),
      supply: jup.circSupply ?? jup.totalSupply ?? 0,
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
    // pump.fun mints default to 6 decimals
    supply: num(a.total_supply) / Math.pow(10, num(a.decimals) || 6),
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
      // the other side is SOL/USDC and would show the quote price instead
      const ourTokenIsTo = (a.to_token_address ?? '') === address;
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
  /** Human label for what the candles actually are, e.g. "SOL/USD" */
  label: string;
  candles: OHLCVCandle[];
}

/**
 * OHLCV for the hero "market wall" — wrapped SOL's deepest pool on
 * Solana (always a real, liquid market to draw), newest ascending.
 * GT OHLCV closes are quoted in USD, so the feed reads as SOL/USD.
 */
/**
 * Top WSOL pool where WSOL is the BASE token — GT pool OHLCV is quoted
 * in base-token USD, so a pool with WSOL as quote would chart the other
 * asset's price under a "SOL/USD" label.
 */
let _refPool: { pool: string; at: number } | null = null;
async function referencePoolFor(): Promise<string | null> {
  if (_refPool && Date.now() - _refPool.at < 300_000) return _refPool.pool;
  const json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${WSOL_MINT}/pools?page=1`);
  const pools = (json.data ?? [])
    .filter((p: any) => (p.relationships?.base_token?.data?.id ?? '').endsWith(`_${WSOL_MINT}`))
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

  // Sanity: the feed must actually track SOL/USD. If the last close is
  // >25% off Jupiter's spot, the pool is mis-oriented — serve nothing
  // rather than a wrong chart (the UI shows an honest NO FEED state).
  const last = candles[candles.length - 1]?.close ?? 0;
  const solUsd = await fetchSolUsd();
  if (last > 0 && solUsd > 0 && Math.abs(last - solUsd) / solUsd > 0.25) {
    return { label: '', candles: [] };
  }
  return { label: 'SOL/USD', candles };
}

/** Search Solana pools by symbol/name (best-effort via pools search). */
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
    if (!address || seen.has(address)) continue;
    seen.add(address);
    if (!isPumpFunToken(address)) continue; // pump.fun coins only
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
