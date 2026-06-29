// ──────────────────────────────────────────────
// FRONT PROTOCOL — Burns Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';

const router = Router();

/**
 * GET /burns
 *
 * Return recent $APE burns, paginated.
 * Query params: limit (default 20, max 100), offset (default 0)
 */
router.get('/', publicLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const [burns, total] = await Promise.all([
      prisma.burn.findMany({
        include: {
          position: {
            select: {
              id: true,
              userWallet: true,
              tier: true,
              token: {
                select: {
                  address: true,
                  symbol: true,
                },
              },
            },
          },
        },
        orderBy: { burnedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.burn.count(),
    ]);

    const data = burns.map((burn) => ({
      id: burn.id,
      solAmount: burn.solAmount,
      tokenAmount: burn.tokenAmount,
      txSignature: burn.txSignature,
      burnedAt: burn.burnedAt,
      position: burn.position
        ? {
            id: burn.position.id,
            userWallet: burn.position.userWallet,
            tier: burn.position.tier,
            tokenSymbol: burn.position.token.symbol,
            tokenAddress: burn.position.token.address,
          }
        : null,
    }));

    sendPaginated(res, data, total, limit, offset);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /burns/stats
 *
 * Return burn statistics: total burned, burn rate (24h), cumulative data.
 */
router.get('/stats', publicLimiter, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalAgg, recent24hAgg, totalCount, recent24hCount] = await Promise.all([
      prisma.burn.aggregate({
        _sum: {
          solAmount: true,
          tokenAmount: true,
        },
      }),
      prisma.burn.aggregate({
        where: { burnedAt: { gte: twentyFourHoursAgo } },
        _sum: {
          solAmount: true,
          tokenAmount: true,
        },
      }),
      prisma.burn.count(),
      prisma.burn.count({
        where: { burnedAt: { gte: twentyFourHoursAgo } },
      }),
    ]);

    // Get recent burns for cumulative chart data (last 30 days, daily buckets)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentBurns = await prisma.burn.findMany({
      where: { burnedAt: { gte: thirtyDaysAgo } },
      select: {
        solAmount: true,
        tokenAmount: true,
        burnedAt: true,
      },
      orderBy: { burnedAt: 'asc' },
    });

    // Bucket into daily aggregates
    const dailyBuckets = new Map<string, { solAmount: bigint; tokenAmount: bigint; count: number }>();
    for (const burn of recentBurns) {
      const dateKey = burn.burnedAt.toISOString().split('T')[0];
      const bucket = dailyBuckets.get(dateKey) || { solAmount: 0n, tokenAmount: 0n, count: 0 };
      bucket.solAmount += burn.solAmount;
      bucket.tokenAmount += burn.tokenAmount;
      bucket.count += 1;
      dailyBuckets.set(dateKey, bucket);
    }

    // Convert to cumulative series
    let cumulativeSol = 0n;
    let cumulativeToken = 0n;
    const cumulativeData = Array.from(dailyBuckets.entries()).map(([date, bucket]) => {
      cumulativeSol += bucket.solAmount;
      cumulativeToken += bucket.tokenAmount;
      return {
        date,
        dailySolBurned: bucket.solAmount,
        dailyTokensBurned: bucket.tokenAmount,
        dailyCount: bucket.count,
        cumulativeSolBurned: cumulativeSol,
        cumulativeTokensBurned: cumulativeToken,
      };
    });

    sendSuccess(res, {
      totalSolBurned: totalAgg._sum.solAmount ?? 0n,
      totalTokensBurned: totalAgg._sum.tokenAmount ?? 0n,
      totalBurnCount: totalCount,
      burnRate24h: {
        solBurned: recent24hAgg._sum.solAmount ?? 0n,
        tokensBurned: recent24hAgg._sum.tokenAmount ?? 0n,
        burnCount: recent24hCount,
      },
      cumulativeData,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
