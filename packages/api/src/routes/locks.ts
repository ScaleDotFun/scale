// ──────────────────────────────────────────────
// FRONT PROTOCOL — Locks Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';

const router = Router();

/**
 * GET /locks
 *
 * Return the authenticated user's locked $FRONT with unlock dates.
 */
router.get('/', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    const where = { userWallet: wallet };

    const [locks, total] = await Promise.all([
      prisma.profitLock.findMany({
        where,
        include: {
          position: {
            select: {
              id: true,
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
        orderBy: { lockedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.profitLock.count({ where }),
    ]);

    const now = new Date();

    const data = locks.map((lock) => ({
      id: lock.id,
      solAmount: String(lock.solAmount),
      tokenAmount: String(lock.tokenAmount),
      lockedAt: lock.lockedAt,
      unlocksAt: lock.unlocksAt,
      isUnlocked: lock.isUnlocked,
      isExpired: now >= lock.unlocksAt,
      timeRemainingMs: Math.max(0, lock.unlocksAt.getTime() - now.getTime()),
      buyTx: lock.buyTx,
      unlockTx: lock.unlockTx,
      position: lock.position
        ? {
            id: lock.position.id,
            tier: lock.position.tier,
            tokenAddress: lock.position.token.address,
            tokenSymbol: lock.position.token.symbol,
          }
        : null,
    }));

    // Compute summary stats from the current page
    // Note: summary is computed from returned locks; for global stats use /locks/global
    const totalLocked = locks
      .filter((l) => !l.isUnlocked)
      .reduce((sum, l) => sum + l.tokenAmount, 0n);
    const totalUnlocked = locks
      .filter((l) => l.isUnlocked)
      .reduce((sum, l) => sum + l.tokenAmount, 0n);
    const pendingUnlock = locks
      .filter((l) => !l.isUnlocked && now >= l.unlocksAt)
      .reduce((sum, l) => sum + l.tokenAmount, 0n);

    sendSuccess(res, {
      locks: data,
      summary: {
        totalLocked: String(totalLocked),
        totalUnlocked: String(totalUnlocked),
        pendingUnlock: String(pendingUnlock),
        activeLockCount: locks.filter((l) => !l.isUnlocked).length,
      },
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /locks/global
 *
 * Return global lock stats: total locked, total unlocked, upcoming unlocks.
 */
router.get('/global', publicLimiter, async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalLockedAgg,
      totalUnlockedAgg,
      upcomingUnlocksAgg,
      activeLockCount,
      totalLockCount,
    ] = await Promise.all([
      // Total currently locked (not yet unlocked)
      prisma.profitLock.aggregate({
        where: { isUnlocked: false },
        _sum: {
          tokenAmount: true,
          solAmount: true,
        },
      }),
      // Total already unlocked
      prisma.profitLock.aggregate({
        where: { isUnlocked: true },
        _sum: {
          tokenAmount: true,
          solAmount: true,
        },
      }),
      // Upcoming unlocks in the next 7 days
      prisma.profitLock.aggregate({
        where: {
          isUnlocked: false,
          unlocksAt: { gte: now, lte: sevenDaysFromNow },
        },
        _sum: {
          tokenAmount: true,
          solAmount: true,
        },
        _count: true,
      }),
      prisma.profitLock.count({ where: { isUnlocked: false } }),
      prisma.profitLock.count(),
    ]);

    // Get the next 10 upcoming unlocks for display
    const upcomingUnlocks = await prisma.profitLock.findMany({
      where: {
        isUnlocked: false,
        unlocksAt: { gte: now },
      },
      select: {
        id: true,
        tokenAmount: true,
        solAmount: true,
        unlocksAt: true,
      },
      orderBy: { unlocksAt: 'asc' },
      take: 10,
    });

    sendSuccess(res, {
      totalLocked: {
        tokenAmount: String(totalLockedAgg._sum.tokenAmount ?? 0n),
        solAmount: String(totalLockedAgg._sum.solAmount ?? 0n),
      },
      totalUnlocked: {
        tokenAmount: String(totalUnlockedAgg._sum.tokenAmount ?? 0n),
        solAmount: String(totalUnlockedAgg._sum.solAmount ?? 0n),
      },
      upcoming7d: {
        tokenAmount: String(upcomingUnlocksAgg._sum.tokenAmount ?? 0n),
        solAmount: String(upcomingUnlocksAgg._sum.solAmount ?? 0n),
        count: upcomingUnlocksAgg._count,
      },
      activeLockCount,
      totalLockCount,
      nextUnlocks: upcomingUnlocks.map((u) => ({
        id: u.id,
        tokenAmount: String(u.tokenAmount),
        solAmount: String(u.solAmount),
        unlocksAt: u.unlocksAt,
        timeRemainingMs: Math.max(0, u.unlocksAt.getTime() - now.getTime()),
      })),
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
