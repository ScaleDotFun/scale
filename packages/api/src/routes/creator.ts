// ──────────────────────────────────────────────
// FRONT PROTOCOL — Creator Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { WEI_PER_ETH, getTierConfig, type Tier } from '@front-protocol/core';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError, ForbiddenError, InsufficientFundsError } from '../lib/errors';

const router = Router();

/** Minimum claimable amount: 0.05 ETH in wei (≈ the old 0.5 SOL in USD) */
const MIN_CLAIM_LAMPORTS = WEI_PER_ETH / 20n;

/**
 * GET /creator/dashboard
 *
 * Return the creator's tokens with earnings, volume, and stats.
 */
async function buildCreatorDashboard(wallet: string) {
    // Fetch all tokens this creator has listed
    const tokens = await prisma.token.findMany({
      where: { creatorWallet: wallet },
      orderBy: { listedAt: 'desc' },
    });

    if (tokens.length === 0) {
      return {
        tokens: [],
        totals: {
          totalTradingVolume: '0',
          totalEarnings: '0',
          unclaimedEarnings: '0',
          tokenCount: 0,
        },
      };
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tokenIds = tokens.map((t) => t.id);

    // Get unclaimed (claimable) payouts for this creator
    const unclaimedAgg = await prisma.creatorPayout.aggregate({
      where: {
        creatorWallet: wallet,
        status: { in: ['pending', 'claimable'] },
      },
      _sum: { amount: true },
    });

    // Get today's volume across all creator tokens
    const todayVolumeAgg = await prisma.position.aggregate({
      where: {
        tokenId: { in: tokenIds },
        openedAt: { gte: twentyFourHoursAgo },
      },
      _sum: {
        userCapital: true,
        protocolCapital: true,
      },
    });

    // Get today's earnings (creator payouts created today)
    const todayEarningsAgg = await prisma.creatorPayout.aggregate({
      where: {
        creatorWallet: wallet,
        createdAt: { gte: twentyFourHoursAgo },
      },
      _sum: { amount: true },
    });

    // Batch all per-token aggregations into 3 groupBy queries (eliminates N+1)
    const [volumeByToken, unclaimedByToken, todayEarningsByToken] = await Promise.all([
      // Today's volume grouped by tokenId
      prisma.position.groupBy({
        by: ['tokenId'],
        where: {
          tokenId: { in: tokenIds },
          openedAt: { gte: twentyFourHoursAgo },
        },
        _sum: {
          userCapital: true,
          protocolCapital: true,
        },
      }),
      // Unclaimed payouts grouped by tokenId
      prisma.creatorPayout.groupBy({
        by: ['tokenId'],
        where: {
          tokenId: { in: tokenIds },
          status: { in: ['pending', 'claimable'] },
        },
        _sum: { amount: true },
      }),
      // Today's earnings grouped by tokenId
      prisma.creatorPayout.groupBy({
        by: ['tokenId'],
        where: {
          tokenId: { in: tokenIds },
          createdAt: { gte: twentyFourHoursAgo },
        },
        _sum: { amount: true },
      }),
    ]);

    // Index results by tokenId for O(1) lookup
    const volumeMap = new Map(volumeByToken.map((v) => [v.tokenId, v._sum]));
    const unclaimedMap = new Map(unclaimedByToken.map((u) => [u.tokenId, u._sum.amount ?? 0n]));
    const todayEarningsMap = new Map(todayEarningsByToken.map((e) => [e.tokenId, e._sum.amount ?? 0n]));

    // Build per-token dashboard items (no additional queries)
    const dashboardTokens = tokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      const vol = volumeMap.get(token.id);
      const todayVolume = (vol?.userCapital ?? 0n) + (vol?.protocolCapital ?? 0n);

      return {
        tokenAddress: token.address,
        tokenName: token.name,
        tokenSymbol: token.symbol,
        tier: token.tier,
        tierEmoji: config.emoji,
        listedAt: token.listedAt,
        isActive: token.isActive,
        totalTradingVolume: String(token.totalTradingVolume),
        totalFeesGenerated: String(token.totalFeesClaimed),
        totalEarnings: String(token.totalCreatorPayouts),
        todayTradingVolume: String(todayVolume),
        todayEarnings: String(todayEarningsMap.get(token.id) ?? 0n),
        unclaimedEarnings: String(unclaimedMap.get(token.id) ?? 0n),
      };
    });

    const todayVolume =
      (todayVolumeAgg._sum.userCapital ?? 0n) +
      (todayVolumeAgg._sum.protocolCapital ?? 0n);

    return {
      tokens: dashboardTokens,
      totals: {
        totalTradingVolume: String(tokens.reduce((sum, t) => sum + t.totalTradingVolume, 0n)),
        totalEarnings: String(tokens.reduce((sum, t) => sum + t.totalCreatorPayouts, 0n)),
        totalFeesClaimed: String(tokens.reduce((sum, t) => sum + t.totalFeesClaimed, 0n)),
        unclaimedEarnings: String(unclaimedAgg._sum.amount ?? 0n),
        todayVolume: String(todayVolume),
        todayEarnings: String(todayEarningsAgg._sum.amount ?? 0n),
        tokenCount: tokens.length,
      },
    };
}

router.get('/dashboard', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    sendSuccess(res, await buildCreatorDashboard(authReq.wallet!));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /creator/dashboard/:wallet
 *
 * Public read-only creator lookup by wallet (Creator page paste-a-wallet
 * flow). Same data as the authed dashboard — it's all public on-chain /
 * ledger information.
 */
router.get('/dashboard/:wallet', publicLimiter, async (req, res) => {
  try {
    const wallet = String(req.params.wallet);
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      throw new ValidationError('Invalid wallet — must be a Robinhood Chain (0x…) address');
    }
    sendSuccess(res, await buildCreatorDashboard(wallet));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /creator/payouts
 *
 * Return the creator's payout history, paginated.
 * Query params: limit (default 20, max 100), offset (default 0), status (optional)
 */
async function respondCreatorPayouts(
  wallet: string,
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const statusFilter = req.query.status as string | undefined;

    const where: Record<string, unknown> = { creatorWallet: wallet };
    if (statusFilter && ['pending', 'claimable', 'claimed'].includes(statusFilter)) {
      where.status = statusFilter;
    }

    const [payouts, total] = await Promise.all([
      prisma.creatorPayout.findMany({
        where,
        include: {
          token: {
            select: {
              address: true,
              name: true,
              symbol: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.creatorPayout.count({ where }),
    ]);

    const data = payouts.map((p) => ({
      id: p.id,
      token: p.token,
      amount: String(p.amount),
      status: p.status,
      claimTx: p.claimTx,
      createdAt: p.createdAt,
      claimedAt: p.claimedAt,
    }));

    sendPaginated(res, data, total, limit, offset);
}

router.get('/payouts', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await respondCreatorPayouts(authReq.wallet!, req, res);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /creator/payouts/:wallet
 *
 * Public read-only payout history by wallet (Creator lookup page).
 */
router.get('/payouts/:wallet', publicLimiter, async (req, res) => {
  try {
    const wallet = String(req.params.wallet);
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      throw new ValidationError('Invalid wallet — must be a Robinhood Chain (0x…) address');
    }
    await respondCreatorPayouts(wallet, req, res);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /creator/claim
 *
 * Claim accumulated earnings. Requires minimum 0.5 SOL accumulated.
 * This marks the payouts as claimed; the actual SOL transfer is handled by services.
 */
router.post('/claim', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;

    // Pre-check: sum claimable payouts to validate minimum before attempting claim
    const claimableAgg = await prisma.creatorPayout.aggregate({
      where: {
        creatorWallet: wallet,
        status: { in: ['pending', 'claimable'] },
      },
      _sum: { amount: true },
      _count: true,
    });

    if (claimableAgg._count === 0) {
      throw new ValidationError('No claimable payouts found');
    }

    const estimatedAmount = claimableAgg._sum.amount ?? 0n;

    if (estimatedAmount < MIN_CLAIM_LAMPORTS) {
      throw new InsufficientFundsError(
        `Minimum claim amount is 0.05 ETH. Current claimable: ${(Number(estimatedAmount) / 1e18).toFixed(6)} ETH`,
      );
    }

    // Atomically mark unclaimed payouts as claimed.
    // The WHERE condition ensures concurrent requests cannot double-claim:
    // only rows still in 'pending'/'claimable' status will be updated.
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.creatorPayout.updateMany({
        where: {
          creatorWallet: wallet,
          status: { in: ['pending', 'claimable'] },
        },
        data: {
          status: 'claimed',
          claimedAt: now,
        },
      });

      if (updated.count === 0) {
        throw new ValidationError('Payouts were already claimed by a concurrent request');
      }

      // Sum the just-claimed payouts to get the exact amount
      const claimedSum = await tx.creatorPayout.aggregate({
        where: {
          creatorWallet: wallet,
          status: 'claimed',
          claimedAt: now,
        },
        _sum: { amount: true },
      });

      const totalAmount = claimedSum._sum.amount ?? 0n;

      // Record pool outflow
      await tx.poolLedger.create({
        data: {
          type: 'creator_payout',
          amount: -totalAmount,
        },
      });

      return { totalAmount, count: updated.count };
    });

    sendSuccess(res, {
      claimedAmount: String(result.totalAmount),
      payoutCount: result.count,
      message: 'Claim initiated. SOL will be transferred to your wallet shortly.',
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /creator/volume/:tokenAddress
 *
 * Return detailed volume stats for a specific token owned by the creator.
 */
router.get('/volume/:tokenAddress', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;
    const tokenAddress = req.params.tokenAddress as string;

    const token = await prisma.token.findUnique({
      where: { address: tokenAddress },
    });

    if (!token) {
      throw new NotFoundError('Token', tokenAddress);
    }
    if (token.creatorWallet !== wallet) {
      throw new ForbiddenError('You are not the creator of this token');
    }

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Aggregate volumes for different time periods
    const [volume1h, volume24h, volume7d, volume30d, totalPositions, activePositions] = await Promise.all([
      prisma.position.aggregate({
        where: { tokenId: token.id, openedAt: { gte: oneHourAgo } },
        _sum: { userCapital: true, protocolCapital: true },
        _count: true,
      }),
      prisma.position.aggregate({
        where: { tokenId: token.id, openedAt: { gte: twentyFourHoursAgo } },
        _sum: { userCapital: true, protocolCapital: true },
        _count: true,
      }),
      prisma.position.aggregate({
        where: { tokenId: token.id, openedAt: { gte: sevenDaysAgo } },
        _sum: { userCapital: true, protocolCapital: true },
        _count: true,
      }),
      prisma.position.aggregate({
        where: { tokenId: token.id, openedAt: { gte: thirtyDaysAgo } },
        _sum: { userCapital: true, protocolCapital: true },
        _count: true,
      }),
      prisma.position.count({ where: { tokenId: token.id } }),
      prisma.position.count({ where: { tokenId: token.id, status: 'open' } }),
    ]);

    const sumVolume = (agg: { _sum: { userCapital: bigint | null; protocolCapital: bigint | null } }) =>
      (agg._sum.userCapital ?? 0n) + (agg._sum.protocolCapital ?? 0n);

    sendSuccess(res, {
      tokenAddress: token.address,
      tokenName: token.name,
      tokenSymbol: token.symbol,
      volume: {
        '1h': String(sumVolume(volume1h)),
        '24h': String(sumVolume(volume24h)),
        '7d': String(sumVolume(volume7d)),
        '30d': String(sumVolume(volume30d)),
        allTime: String(token.totalTradingVolume),
      },
      trades: {
        '1h': volume1h._count,
        '24h': volume24h._count,
        '7d': volume7d._count,
        '30d': volume30d._count,
        total: totalPositions,
        active: activePositions,
      },
      totalFeesClaimed: String(token.totalFeesClaimed),
      totalCreatorPayouts: String(token.totalCreatorPayouts),
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
