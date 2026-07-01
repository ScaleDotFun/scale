// ──────────────────────────────────────────────
// FRONT PROTOCOL — Stats Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';

const router = Router();

/**
 * GET /stats
 *
 * Return protocol-wide statistics: total burned, pool size, trades executed,
 * listed tokens, active positions, total creator payouts.
 */
router.get('/stats', publicLimiter, async (req, res) => {
  try {
    const [
      burnAgg,
      lockAgg,
      poolAgg,
      creatorPayoutAgg,
      totalPositions,
      activePositions,
      totalListedTokens,
      activeListedTokens,
    ] = await Promise.all([
      // Total burned
      prisma.burn.aggregate({
        _sum: {
          solAmount: true,
          tokenAmount: true,
        },
      }),
      // Total locked (currently locked, not unlocked)
      prisma.profitLock.aggregate({
        where: { isUnlocked: false },
        _sum: {
          solAmount: true,
          tokenAmount: true,
        },
      }),
      // Pool balance (sum of all ledger entries)
      prisma.poolLedger.aggregate({
        _sum: { amount: true },
      }),
      // Total creator payouts (claimed)
      prisma.creatorPayout.aggregate({
        where: { status: 'claimed' },
        _sum: { amount: true },
      }),
      // Total trades (positions ever opened)
      prisma.position.count(),
      // Currently active positions
      prisma.position.count({ where: { status: 'open' } }),
      // Total listed tokens
      prisma.token.count(),
      // Active listed tokens
      prisma.token.count({ where: { isActive: true } }),
    ]);

    sendSuccess(res, {
      totalBurnedLamports: burnAgg._sum.solAmount ?? 0n,
      totalBurnedTokens: burnAgg._sum.tokenAmount ?? 0n,
      totalLockedLamports: lockAgg._sum.solAmount ?? 0n,
      totalLockedTokens: lockAgg._sum.tokenAmount ?? 0n,
      poolSizeLamports: poolAgg._sum.amount ?? 0n,
      totalCreatorPayoutsLamports: creatorPayoutAgg._sum.amount ?? 0n,
      totalTradesExecuted: totalPositions,
      totalListedTokens,
      activeListedTokens,
      activePositions,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /pool
 *
 * Return capital pool info: current balance, inflows/outflows today, utilization rate.
 */
router.get('/pool', publicLimiter, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [poolBalance, todayEntries, capitalLocked] = await Promise.all([
      // Current total pool balance
      prisma.poolLedger.aggregate({
        _sum: { amount: true },
      }),
      // Today's ledger entries
      prisma.poolLedger.findMany({
        where: { createdAt: { gte: twentyFourHoursAgo } },
        select: {
          type: true,
          amount: true,
        },
      }),
      // Capital currently locked in open positions
      prisma.position.aggregate({
        where: { status: 'open' },
        _sum: { protocolCapital: true },
      }),
    ]);

    const balance = poolBalance._sum.amount ?? 0n;
    const lockedCapital = capitalLocked._sum.protocolCapital ?? 0n;

    // Separate inflows and outflows for today
    let inflowsToday = 0n;
    let outflowsToday = 0n;
    const flowsByType = new Map<string, bigint>();

    for (const entry of todayEntries) {
      const current = flowsByType.get(entry.type) ?? 0n;
      flowsByType.set(entry.type, current + entry.amount);

      if (entry.amount > 0n) {
        inflowsToday += entry.amount;
      } else {
        outflowsToday += entry.amount; // negative
      }
    }

    // Utilization rate = capital locked in open positions / total pool balance
    const utilizationRate = balance > 0n
      ? Number(lockedCapital * 10000n / balance) / 100
      : 0;

    sendSuccess(res, {
      balance,
      lockedCapital,
      availableCapital: balance > lockedCapital ? balance - lockedCapital : 0n,
      utilizationRate,
      today: {
        inflows: inflowsToday,
        outflows: outflowsToday,
        net: inflowsToday + outflowsToday,
        byType: Object.fromEntries(flowsByType),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /admin/seed-pool
 *
 * Seed the pool ledger with an initial deposit. Protected by ADMIN_SECRET.
 * Body: { amountLamports: string }
 */
router.post('/admin/seed-pool', async (req, res) => {
  try {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const amountLamports = BigInt(req.body.amountLamports || '0');
    if (amountLamports <= 0n) {
      return res.status(400).json({ success: false, error: 'amountLamports must be positive' });
    }

    await prisma.poolLedger.create({
      data: {
        type: 'initial_deposit',
        amount: amountLamports,
        txSignature: 'admin-seed-deposit',
      },
    });

    const poolAgg = await prisma.poolLedger.aggregate({ _sum: { amount: true } });

    sendSuccess(res, {
      message: 'Pool seeded',
      deposited: amountLamports.toString(),
      totalPool: (poolAgg._sum.amount ?? 0n).toString(),
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
