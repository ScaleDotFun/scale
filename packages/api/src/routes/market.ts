// ──────────────────────────────────────────────
// SCALE PROTOCOL — Market Data Routes (Robinhood Chain / GeckoTerminal)
//
// The protocol targets Robinhood Chain (Arbitrum Orbit L2, chain 4663)
// and Noxa (fun.noxa.fi) launches. Market data comes from GeckoTerminal's
// `robinhood` network — real pools, prices and OHLCV, no API key.
// Response shapes are kept identical to the previous Birdeye endpoints
// so the frontend (screener, chart, token pages) works unchanged.
// ──────────────────────────────────────────────

import { Router } from 'express';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError } from '../lib/errors';
import * as gt from '../lib/geckoterminal';

const router = Router();

/** Robinhood Chain uses EVM addresses (0x + 40 hex). */
function validateTokenAddress(address: string): void {
  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid token address — expected a Robinhood Chain (EVM) address');
  }
}

const TRENDING_CACHE_MS = 60_000;
let trendingCache: { data: gt.MarketToken[]; at: number } | null = null;

/** Tiny keyed TTL cache — GeckoTerminal free tier is ~30 calls/min,
 *  so every fan-out endpoint (candles, trades, token) caches briefly
 *  server-side instead of letting each browser hammer GT. */
const ttlCache = new Map<string, { data: unknown; at: number }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = ttlCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  try {
    const data = await fn();
    ttlCache.set(key, { data, at: Date.now() });
    if (ttlCache.size > 500) {
      // evict oldest entries so the map can't grow unbounded
      const oldest = [...ttlCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
      for (const [k] of oldest) ttlCache.delete(k);
    }
    return data;
  } catch (err) {
    if (hit) return hit.data as T; // stale-if-error
    throw err;
  }
}

/**
 * GET /market/trending — trending memecoins on Robinhood Chain.
 */
router.get('/trending', publicLimiter, async (_req, res) => {
  try {
    if (trendingCache && Date.now() - trendingCache.at < TRENDING_CACHE_MS) {
      return sendSuccess(res, trendingCache.data);
    }
    const data = await gt.fetchTrending();
    if (data.length > 0) trendingCache = { data, at: Date.now() };
    sendSuccess(res, data);
  } catch (err) {
    if (trendingCache) return sendSuccess(res, trendingCache.data); // stale-if-error
    sendError(res, err);
  }
});

/**
 * GET /market/search?q=keyword — search Robinhood Chain tokens.
 */
router.get('/search', publicLimiter, async (req, res) => {
  try {
    const query = (req.query.q as string) || '';
    if (!query || query.length < 2) return sendSuccess(res, []);
    sendSuccess(res, await gt.searchTokens(query));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address — single token overview.
 */
router.get('/token/:address', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const t = await cached(`token:${address}`, 15_000, () => gt.fetchToken(address));
    sendSuccess(res, {
      address: t.address,
      name: t.name,
      symbol: t.symbol,
      price: t.price,
      priceChange24h: t.priceChange24h,
      volume24h: t.volume24h,
      marketCap: t.marketCap,
      liquidity: t.liquidity,
      holders: 0,
      supply: t.supply,
      logoURI: t.logoURI,
      extensions: {},
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/price-history — OHLCV for charts.
 * Query: type (1m,5m,15m,1H,4H,1D), time_from, time_to.
 */
router.get('/token/:address/price-history', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const type = (req.query.type as string) || '1H';
    const timeTo = req.query.time_to ? Number(req.query.time_to) : undefined;
    const key = `ohlcv:${address}:${type}:${timeTo ?? 'now'}`;
    const candles = await cached(key, 10_000, () => gt.fetchOHLCV(address, type, timeTo));
    sendSuccess(res, candles);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/trades — recent real swaps (top pool).
 */
router.get('/token/:address/trades', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    sendSuccess(res, await cached(`trades:${address}:${limit}`, 10_000, () => gt.fetchTrades(address, limit)));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/pool — top Uniswap V3 pool address
 * (used for the GeckoTerminal chart embed).
 */
router.get('/token/:address/pool', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    sendSuccess(res, { pool: await cached(`pool:${address}`, 300_000, () => gt.topPoolFor(address)) });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/reference-history — WETH/USD OHLCV for the landing hero.
 * Robinhood Chain's gas + quote asset is ETH, so the hero wall tracks WETH.
 */
router.get('/reference-history', publicLimiter, async (req, res) => {
  try {
    const type = (req.query.type as string) || '15m';
    const feed = await cached(`ref:${type}`, 30_000, () => gt.fetchReferenceOHLCV(type));
    sendSuccess(res, feed);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
