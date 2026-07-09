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

/** ETH/USD via the WETH token price on Robinhood Chain (60s cache, stale-if-error). */
let ethUsdCache: { price: number; at: number } | null = null;
export async function fetchEthUsd(): Promise<number> {
  if (ethUsdCache && Date.now() - ethUsdCache.at < 60_000) return ethUsdCache.price;
  try {
    const json = await gtFetch(`/simple/networks/${GT_NETWORK}/token_price/${WETH_ROBINHOOD}`);
    const prices = json?.data?.attributes?.token_prices ?? {};
    const price = num(prices[WETH_ROBINHOOD.toLowerCase()] ?? prices[WETH_ROBINHOOD]);
    if (price > 0) ethUsdCache = { price, at: Date.now() };
  } catch {
    // fall through to stale value
  }
  return ethUsdCache?.price ?? 0;
}

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
  const addr = address.toLowerCase();
  return (json.data ?? [])
    .map((t: any) => {
      const a = t.attributes ?? {};
      const isBuy = a.kind === 'buy';
      // amount + price: whichever side of the swap is OUR token —
      // the other side is WETH and would show the ETH price instead
      const ourTokenIsTo = (a.to_token_address ?? '').toLowerCase() === addr;
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
  /** Human label for what the candles actually are, e.g. "CASHCAT/USD" */
  label: string;
  candles: OHLCVCandle[];
}

/**
 * OHLCV for the hero "market wall" — the single most-liquid trending pool
 * on Robinhood Chain (always a real, deep market to draw), newest ascending.
 * Returns the pool's real name so the UI never mislabels the feed.
 */
export async function fetchReferenceOHLCV(type: string, limit = 96): Promise<ReferenceFeed> {
  const json = await gtFetch(`/networks/${GT_NETWORK}/trending_pools?page=1`);
  const pools = (json.data ?? [])
    .map((p: any) => ({
      addr: p.attributes?.address,
      name: p.attributes?.name ?? '',
      liq: num(p.attributes?.reserve_in_usd),
    }))
    .filter((p: any) => p.addr)
    .sort((a: any, b: any) => b.liq - a.liq);
  const top = pools[0];
  if (!top) return { label: '', candles: [] };
  // GT pool name looks like "CASHCAT / WETH 1%" — show it as TOKEN/USD
  // since GT OHLCV closes are quoted in USD
  const base = String(top.name).split('/')[0]?.trim() || 'TOP POOL';
  const { tf, agg } = gtTimeframe(type);
  const j = await gtFetch(`/networks/${GT_NETWORK}/pools/${top.addr}/ohlcv/${tf}?aggregate=${agg}&limit=${limit}`);
  const list: number[][] = j.data?.attributes?.ohlcv_list ?? [];
  const candles = list
    .map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }))
    .filter((c) => c.timestamp > 0 && c.close > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
  return { label: `${base}/USD`, candles };
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
