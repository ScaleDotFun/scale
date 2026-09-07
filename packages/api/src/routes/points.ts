// ──────────────────────────────────────────────
// LOADED PROTOCOL — Points & Referrals Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@loaded/database';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';
import { ensureReferralCode, POINTS_PER_SOL, REFERRAL_BONUS_BPS } from '../lib/points';

const router = Router();

/**
 * GET /points/me — the signed-in user's points, rank, and referral stats.
 */
router.get('/me', verifyWalletSignature, async (req: AuthenticatedRequest, res) => {
  try {
    const wallet = req.wallet!;
    const userId = req.userId!;

    const [totalAgg, byType, code, referralCount] = await Promise.all([
      prisma.pointsLedger.aggregate({ where: { userWallet: wallet }, _sum: { points: true } }),
      prisma.pointsLedger.groupBy({
        by: ['type'],
        where: { userWallet: wallet },
        _sum: { points: true },
      }),
      ensureReferralCode(userId),
      prisma.user.count({ where: { referredById: userId } }),
      Promise.resolve(null),
    ]);

    const total = totalAgg._sum.points ?? 0n;

    // Rank: how many wallets have strictly more points, +1
    const higher = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT user_wallet, SUM(points) AS total
        FROM points_ledger GROUP BY user_wallet HAVING SUM(points) > ${total}
      ) t`;
    const rank = total > 0n ? Number(higher[0]?.count ?? 0n) + 1 : null;

    const breakdown: Record<string, string> = {};
    for (const row of byType) breakdown[row.type] = (row._sum.points ?? 0n).toString();

    sendSuccess(res, {
      totalPoints: total.toString(),
      rank,
      breakdown,
      referralCode: code,
      referralCount,
      pointsPerEth: POINTS_PER_SOL.toString(),
      referralBonusPct: Number(REFERRAL_BONUS_BPS) / 100,
    });
  } catch (err) {
    console.error('[points] /me failed:', err);
    sendError(res, err);
  }
});

/**
 * GET /points/leaderboard — top wallets by points (public, screenshottable).
 */
router.get('/leaderboard', publicLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 25, 100);
    const rows = await prisma.pointsLedger.groupBy({
      by: ['userWallet'],
      _sum: { points: true },
      orderBy: { _sum: { points: 'desc' } },
      take: limit,
    });
    const totalWallets = (await prisma.pointsLedger.groupBy({ by: ['userWallet'] })).length;

    sendSuccess(res, {
      totalWallets,
      leaderboard: rows.map((r, i) => ({
        rank: i + 1,
        wallet: r.userWallet,
        display: `${r.userWallet.slice(0, 4)}…${r.userWallet.slice(-4)}`,
        points: (r._sum.points ?? 0n).toString(),
      })),
    });
  } catch (err) {
    console.error('[points] /leaderboard failed:', err);
    sendError(res, err);
  }
});

export default router;
