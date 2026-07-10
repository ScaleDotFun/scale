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
import { watchPool, liveCandles } from '../lib/liveTicks';

const router = Router();

/** Robinhood Chain uses EVM addresses (0x + 40 hex). */
function validateTokenAddress(address: string): void {
  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid token address — expected a Robinhood Chain (EVM) address');
  }
}

const TRENDING_CACHE_MS = 60_000;
let trendingCache: { data: gt.MarketToken[]; at: number } | null = null;

// ── Hot-feed warmer ─────────────────────────────────────────
// The screener and landing hero are the first things every visitor
// loads. Cold caches right after a deploy + GT free-tier 429s used to
// surface as "FEED OFFLINE" flashes, so the server keeps these two
// feeds perpetually warm itself (with jitter to dodge GT rate windows)
// and clients only ever read from memory.
async function warmHotFeeds(): Promise<void> {
  try {
    const data = await gt.fetchTrending();
    if (data.length > 0) trendingCache = { data, at: Date.now() };
  } catch (err) {
    console.warn('[market] trending warm failed:', err instanceof Error ? err.message : err);
  }
  try {
    const feed = await gt.fetchReferenceOHLCV('15m');
    if (feed.candles.length > 0) ttlCache.set('ref:15m', { data: feed, at: Date.now() });
  } catch (err) {
    console.warn('[market] reference warm failed:', err instanceof Error ? err.message : err);
  }
}
// warm immediately at boot, then refresh every 45s (±5s jitter)
setTimeout(warmHotFeeds, 1_500);
setInterval(() => {
  setTimeout(warmHotFeeds, Math.random() * 10_000);
}, 30_000).unref();

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
    // The warmer keeps this fresh; serve whatever we have (stale beats
    // a 429 pass-through) and only call GT inline before the first warm
    if (trendingCache) return sendSuccess(res, trendingCache.data);
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
    const t = await cached(`token:${address}`, 10_000, () => gt.fetchToken(address));
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
    const candles = await cached(key, 5_000, () => gt.fetchOHLCV(address, type, timeTo));
    sendSuccess(res, candles);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /market/token/:address/live-history — seconds-level candles built
 * from Uniswap V3 Swap events read directly off Robinhood Chain.
 * Query: type (1s|5s|15s), limit. The watcher self-starts on first
 * request and expires 90s after the last one.
 */
router.get('/token/:address/live-history', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;
    validateTokenAddress(address);
    const tfSec = { '1s': 1, '5s': 5, '15s': 15 }[String(req.query.type || '1s')];
    if (!tfSec) throw new ValidationError('type must be 1s, 5s or 15s');
    const limit = Math.min(Number(req.query.limit) || 300, 900);

    const pool = await cached(`pool:${address}`, 300_000, () => gt.topPoolFor(address));
    if (!pool) return sendSuccess(res, { candles: [], last: 0 });

    const watcher = await watchPool(pool, address);
    sendSuccess(res, liveCandles(watcher, tfSec, limit));
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
    sendSuccess(res, await cached(`trades:${address}:${limit}`, 5_000, () => gt.fetchTrades(address, limit)));
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
