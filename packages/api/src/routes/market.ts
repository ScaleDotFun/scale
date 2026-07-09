// ──────────────────────────────────────────────
// FRONT PROTOCOL — Market Data Routes (Birdeye Proxy)
// ──────────────────────────────────────────────

import { Router } from 'express';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError } from '../lib/errors';

const router = Router();

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY || '';

if (!BIRDEYE_KEY) {
  console.warn('[market] WARNING: BIRDEYE_API_KEY is not set — market data endpoints will return errors');
}

function validateTokenAddress(address: string): void {
  if (
    typeof address !== 'string' ||
    address.length < 32 ||
    address.length > 44 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)
  ) {
    throw new ValidationError('Invalid token address format');
  }
}

async function birdeyeFetch(path: string, params?: Record<string, string>) {
  if (!BIRDEYE_KEY) {
    throw new ValidationError('Market data is unavailable — Birdeye API key is not configured');
  }
  const url = new URL(`${BIRDEYE_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: {
      'X-API-KEY': BIRDEYE_KEY,
      'x-chain': 'solana',
    },
  });
  if (!res.ok) {
    throw new Error(`Birdeye API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * GET /market/trending
 *
 * Quality trending — real volume leaders, not wash-traded dust.
 * Birdeye's raw trending feed surfaces $1-liquidity scams pumping
 * +30000%; instead we take the top tokens by 24h volume with a hard
 * liquidity floor, drop stables/wrapped majors, then cross-verify
 * every candidate against DexScreener's pair data. A token only
 * makes the list if BOTH sources agree it has real liquidity.
 */
const STABLE_OR_WRAPPED = new Set([
  'So11111111111111111111111111111111111111112', // WSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA',  // USDS
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',  // mSOL
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', // jitoSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',  // bSOL
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // wBTC
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // BTC (sollet)
]);

interface TrendingToken {
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

/** Stables / wrapped / LSTs by symbol — not tradeable "coins" */
const BORING_SYMBOLS = /^(w?usd[a-z0-9]*|[a-z0-9]*usd[a-z0-9]?|dai|fdusd|pyusd|eurc|[a-z]{0,3}btc|w?eth|wsteth|sol|msol|jitosol|bsol|jupsol|hsol|inf|lst)$/i;

const MIN_LIQUIDITY_USD = 100_000;
const MIN_MCAP_USD = 250_000;
/** Real markets turn over their liquidity a few times a day; hundreds of
 *  times means wash trading — the classic fake-volume signature */
const MAX_VOL_TO_LIQ = 40;
const TRENDING_CACHE_MS = 120_000;
let trendingCache: { data: TrendingToken[]; at: number } | null = null;

router.get('/trending', publicLimiter, async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.at < TRENDING_CACHE_MS) {
      return sendSuccess(res, trendingCache.data);
    }

    // 1. Top Solana tokens by real 24h volume, hard liquidity floor
    const data = await birdeyeFetch('/defi/tokenlist', {
      sort_by: 'v24hUSD',
      sort_type: 'desc',
      offset: '0',
      limit: '50',
      min_liquidity: String(MIN_LIQUIDITY_USD),
    });

    const candidates: TrendingToken[] = ((data as any)?.data?.tokens || [])
      .map((t: any) => ({
        address: t.address,
        name: t.name || 'Unknown',
        symbol: t.symbol || '???',
        price: t.price || 0,
        priceChange24h: 0, // tokenlist change fields are unreliable — DexScreener fills this
        volume24h: t.v24hUSD || 0,
        marketCap: t.mc || t.marketcap || 0,
        liquidity: t.liquidity || 0,
        logoURI: t.logoURI || null,
      }))
      .filter((t: TrendingToken) =>
        !STABLE_OR_WRAPPED.has(t.address) &&
        !BORING_SYMBOLS.test(t.symbol) &&
        t.price > 0 &&
        t.liquidity >= MIN_LIQUIDITY_USD &&
        t.volume24h / t.liquidity <= MAX_VOL_TO_LIQ &&
        (t.marketCap === 0 || t.marketCap >= MIN_MCAP_USD),
      )
      .slice(0, 30);

    // 2. Cross-verify with DexScreener (batch, no key needed) — keep
    //    only tokens whose best pair confirms real liquidity there too
    let verified = candidates;
    try {
      const addrs = candidates.map((t) => t.address).join(',');
      const dsRes = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${addrs}`);
      if (dsRes.ok) {
        const pairs = (await dsRes.json()) as Array<{
          baseToken?: { address?: string };
          liquidity?: { usd?: number };
          volume?: { h24?: number };
          priceChange?: { h24?: number; h6?: number };
          info?: { imageUrl?: string };
          marketCap?: number;
          fdv?: number;
        }>;
        const best = new Map<string, { liq: number; vol: number; chg: number; img?: string; mc?: number }>();
        for (const p of pairs || []) {
          const addr = p.baseToken?.address;
          if (!addr) continue;
          const liq = p.liquidity?.usd ?? 0;
          const prev = best.get(addr);
          if (!prev || liq > prev.liq) {
            // Day-old pools report "true" but useless h24 (+400000%
            // from dust price) — step down to h6, then cap
            const h24 = p.priceChange?.h24 ?? 0;
            const h6 = p.priceChange?.h6 ?? 0;
            const chg = Math.abs(h24) <= 1000 ? h24
              : Math.abs(h6) <= 1000 ? h6
              : Math.sign(h24) * 999.9;
            best.set(addr, {
              liq,
              vol: p.volume?.h24 ?? 0,
              chg,
              img: p.info?.imageUrl,
              mc: p.marketCap ?? p.fdv,
            });
          }
        }
        verified = candidates
          .filter((t) => {
            const ds = best.get(t.address);
            return ds && ds.liq >= MIN_LIQUIDITY_USD * 0.5;
          })
          .map((t) => {
            const ds = best.get(t.address)!;
            return {
              ...t,
              // Birdeye's tokenlist omits 24h price change — DexScreener has it
              priceChange24h: ds.chg,
              logoURI: t.logoURI || ds.img || null,
              marketCap: t.marketCap || ds.mc || 0,
            };
          });
        // If DexScreener disagrees with everything, trust the filtered
        // Birdeye list rather than serving an empty screener
        if (verified.length < 5) verified = candidates;
      }
    } catch {
      // DexScreener unreachable — filtered Birdeye list stands
    }

    const top = verified.slice(0, 20);
    trendingCache = { data: top, at: Date.now() };
    sendSuccess(res, top);
  } catch (err) {
    // Serve the last good list rather than an error if we have one
    if (trendingCache) return sendSuccess(res, trendingCache.data);
    sendError(res, err);
  }
});

/**
 * GET /market/search?q=keyword
 *
 * Search tokens by name or symbol.
 */
router.get('/search', publicLimiter, async (req, res) => {
  try {
    const query = (req.query.q as string) || '';
    if (!query || query.length < 2) {
      return sendSuccess(res, []);
    }

    const data = await birdeyeFetch('/defi/v3/search', {
      keyword: query,
      chain: 'solana',
      target: 'token',
      sort_by: 'volume_24h_usd',
      sort_type: 'desc',
      offset: '0',
      limit: '10',
    });

    const items = ((data as any)?.data?.items || []).map((item: any) => ({
      address: item.address,
      name: item.name || 'Unknown',
      symbol: item.symbol || '???',
      price: item.price || 0,
      priceChange24h: item.price_change_24h_percent || 0,
      volume24h: item.volume_24h_usd || 0,
      marketCap: item.market_cap || 0,
      liquidity: item.liquidity || 0,
      logoURI: item.logo_uri || null,
    }));

    sendSuccess(res, items);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address
 *
 * Get detailed info for a single token (price, volume, etc.)
 */
router.get('/token/:address', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);

    const [overviewRes, priceRes] = await Promise.all([
      birdeyeFetch('/defi/token_overview', { address: address as string }),
      birdeyeFetch('/defi/price', { address: address as string }),
    ]);

    const overview = (overviewRes as any)?.data || {};
    const price = (priceRes as any)?.data || {};

    sendSuccess(res, {
      address,
      name: overview.name || 'Unknown',
      symbol: overview.symbol || '???',
      price: price.value || overview.price || 0,
      priceChange24h: overview.priceChange24hPercent || 0,
      volume24h: overview.v24hUSD || 0,
      marketCap: overview.mc || 0,
      liquidity: overview.liquidity || 0,
      holders: overview.holder || 0,
      supply: overview.supply || 0,
      logoURI: overview.logoURI || null,
      extensions: overview.extensions || {},
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/price-history
 *
 * Get OHLCV price history for charts.
 * Query params: type (1m, 5m, 15m, 1H, 4H, 1D), time_from, time_to
 */
router.get('/token/:address/price-history', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const type = (req.query.type as string) || '1H';
    const now = Math.floor(Date.now() / 1000);
    const timeFrom = (req.query.time_from as string) || String(now - 24 * 60 * 60);
    const timeTo = (req.query.time_to as string) || String(now);

    const data = await birdeyeFetch('/defi/ohlcv', {
      address: address as string,
      type,
      time_from: timeFrom,
      time_to: timeTo,
    });

    const items = ((data as any)?.data?.items || []).map((item: any) => ({
      timestamp: item.unixTime,
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }));

    sendSuccess(res, items);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/trades
 *
 * Recent trades for a token.
 */
router.get('/token/:address/trades', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const data = await birdeyeFetch('/defi/txs/token', {
      address: address as string,
      tx_type: 'swap',
      sort_type: 'desc',
      offset: '0',
      limit: String(limit),
    });

    const trades = ((data as any)?.data?.items || []).map((tx: any) => ({
      txHash: tx.txHash,
      blockTime: tx.blockUnixTime,
      side: tx.side,
      priceUsd: tx.priceUsd,
      volumeUsd: tx.volumeUsd,
      source: tx.source,
    }));

    sendSuccess(res, trades);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/ws-config
 *
 * Returns the Birdeye WebSocket URL with API key embedded.
 * The frontend should use this instead of embedding the key in client code.
 * This keeps the API key out of browser DevTools / source code.
 */
router.get('/ws-config', publicLimiter, async (_req, res) => {
  try {
    if (!BIRDEYE_KEY) {
      throw new ValidationError('WebSocket unavailable — Birdeye API key is not configured');
    }
    sendSuccess(res, {
      wsUrl: `wss://public-api.birdeye.so/socket/solana?x-api-key=${BIRDEYE_KEY}`,
      // Client should NOT cache this for more than the session
      expiresIn: 3600,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
