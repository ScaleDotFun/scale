// ──────────────────────────────────────────────
// FRONT PROTOCOL — Market Data Routes (Birdeye Proxy)
// ──────────────────────────────────────────────

import { Router } from 'express';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';

const router = Router();

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY || '';

async function birdeyeFetch(path: string, params?: Record<string, string>) {
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
 * Fetch trending Solana tokens from Birdeye.
 */
router.get('/trending', publicLimiter, async (_req, res) => {
  try {
    const data = await birdeyeFetch('/defi/token_trending', {
      sort_by: 'rank',
      sort_type: 'asc',
      offset: '0',
      limit: '20',
    });

    const tokens = ((data as any)?.data?.tokens || []).map((t: any) => ({
      address: t.address,
      name: t.name || 'Unknown',
      symbol: t.symbol || '???',
      price: t.price || 0,
      priceChange24h: t.price24hChangePercent || 0,
      volume24h: t.volume24hUSD || 0,
      marketCap: t.marketcap || t.mc || 0,
      liquidity: t.liquidity || 0,
      logoURI: t.logoURI || null,
    }));

    sendSuccess(res, tokens);
  } catch (err) {
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
    const address = req.params.address;

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
    const address = req.params.address;
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
    const address = req.params.address;
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

export default router;
