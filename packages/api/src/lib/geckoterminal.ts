// ──────────────────────────────────────────────
// SCALE PROTOCOL — Robinhood Chain market data (GeckoTerminal)
//
// Robinhood Chain (Arbitrum Orbit L2, chain id 4663) is covered by
// GeckoTerminal's `robinhood` network — real pools, prices and OHLCV,
// no API key. This is the honest market-data source for the screener,
// token pages and charts now that the protocol targets Robinhood Chain
// and Noxa (fun.noxa.fi) launches instead of Solana / pump.fun.
// ──────────────────────────────────────────────

const GT = 'https://api.geckoterminal.com/api/v2';
export const GT_NETWORK = 'robinhood';

/** WETH on Robinhood Chain — the reference asset for the hero feed. */
export const WETH_ROBINHOOD = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';

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
  const res = await fetch(`${GT}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} on ${path}`);
  return res.json();
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Trending pools on Robinhood Chain → one MarketToken per base token. */
export async function fetchTrending(): Promise<MarketToken[]> {
  const json = await gtFetch(`/networks/${GT_NETWORK}/trending_pools?include=base_token&page=1`);
  const included: Record<string, any> = {};
  for (const inc of json.included ?? []) included[inc.id] = inc.attributes;

  const out: MarketToken[] = [];
  const seen = new Set<string>();
  for (const pool of json.data ?? []) {
    const a = pool.attributes ?? {};
    const btId = pool.relationships?.base_token?.data?.id;
    const bt = btId ? included[btId] : null;
    const address = (bt?.address ?? '').toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);

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
  return out;
}

/** Single token overview on Robinhood Chain. */
export async function fetchToken(address: string): Promise<MarketToken & { supply: number }> {
  const json = await gtFetch(`/networks/${GT_NETWORK}/tokens/${address}?include=top_pools`);
  const a = json.data?.attributes ?? {};
  const topPool = (json.included ?? [])[0]?.attributes ?? {};
  return {
    address: (a.address ?? address).toLowerCase(),
    name: a.name ?? 'Unknown',
    symbol: a.symbol ?? '???',
    price: num(a.price_usd),
    priceChange24h: num(topPool.price_change_percentage?.h24),
    volume24h: num(a.volume_usd?.h24) || num(topPool.volume_usd?.h24),
    marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
    liquidity: num(a.total_reserve_in_usd) || num(topPool.reserve_in_usd),
    logoURI: a.image_url && a.image_url !== 'missing.png' ? a.image_url : null,
    supply: num(a.total_supply) / Math.pow(10, num(a.decimals) || 18),
  };
}

/** Resolve a token's highest-liquidity pool (cached) for OHLCV lookups. */
const poolCache = new Map<string, { pool: string; at: number }>();
async function topPoolFor(address: string): Promise<string | null> {
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

/**
 * OHLCV for the hero "market wall" — the single most-liquid trending pool
 * on Robinhood Chain (always a real, deep market to draw), newest ascending.
 */
export async function fetchReferenceOHLCV(type: string, limit = 96): Promise<OHLCVCandle[]> {
  const json = await gtFetch(`/networks/${GT_NETWORK}/trending_pools?page=1`);
  const pools = (json.data ?? [])
    .map((p: any) => ({ addr: p.attributes?.address, liq: num(p.attributes?.reserve_in_usd) }))
    .filter((p: any) => p.addr)
    .sort((a: any, b: any) => b.liq - a.liq);
  const pool = pools[0]?.addr;
  if (!pool) return [];
  const { tf, agg } = gtTimeframe(type);
  const j = await gtFetch(`/networks/${GT_NETWORK}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`);
  const list: number[][] = j.data?.attributes?.ohlcv_list ?? [];
  return list
    .map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .filter((c) => c.timestamp > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** Search Robinhood-chain pools by symbol/name (best-effort via pools search). */
export async function searchTokens(query: string): Promise<MarketToken[]> {
  const json = await gtFetch(`/search/pools?query=${encodeURIComponent(query)}&network=${GT_NETWORK}&include=base_token`);
  const included: Record<string, any> = {};
  for (const inc of json.included ?? []) included[inc.id] = inc.attributes;
  const out: MarketToken[] = [];
  const seen = new Set<string>();
  for (const pool of json.data ?? []) {
    const a = pool.attributes ?? {};
    const bt = included[pool.relationships?.base_token?.data?.id ?? ''] ?? null;
    const address = (bt?.address ?? '').toLowerCase();
    if (!address || seen.has(address)) continue;
    seen.add(address);
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
