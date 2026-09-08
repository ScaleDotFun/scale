// ──────────────────────────────────────────────
// LOADED PROTOCOL — Creator Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH, getTierConfig, type Tier } from '@loaded/core';
import { isValidAddress, transferNative, getProtocolAccount, hasProtocolKey, getNativeBalance, poolReserveFor } from '@loaded/evm';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError, ForbiddenError, InsufficientFundsError } from '../lib/errors';

const router = Router();

/** Minimum claimable amount: 0.005 ETH in wei */
const MIN_CLAIM_WEI = WEI_PER_ETH / 200n;

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
    if (!isValidAddress(wallet)) {
      throw new ValidationError('Invalid wallet — must be a Robinhood Chain address (0x…)');
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
    if (!isValidAddress(wallet)) {
      throw new ValidationError('Invalid wallet — must be a Robinhood Chain address (0x…)');
    }
    await respondCreatorPayouts(wallet, req, res);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /creator/claim
 *
 * Claim accumulated earnings. Requires minimum 0.005 ETH accumulated.
 * This marks the payouts as claimed; the actual ETH transfer is handled by services.
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

    if (estimatedAmount < MIN_CLAIM_WEI) {
      throw new InsufficientFundsError(
        `Minimum claim amount is 0.005 ETH. Current claimable: ${(Number(estimatedAmount) / 1e18).toFixed(6)} ETH`,
      );
    }

    if (!hasProtocolKey()) {
      throw new ValidationError('Payouts are temporarily paused — pool wallet not configured.');
    }

    // Phase 1 — atomically claim the batch into a transient 'claiming'
    // status (concurrent requests get count=0). claimedAt marks the batch.
    const now = new Date();
    const claimed = await prisma.creatorPayout.updateMany({
      where: {
        creatorWallet: wallet,
        status: { in: ['pending', 'claimable'] },
      },
      data: { status: 'claiming', claimedAt: now },
    });
    if (claimed.count === 0) {
      throw new ValidationError('Payouts were already claimed by a concurrent request');
    }
    const claimedSum = await prisma.creatorPayout.aggregate({
      where: { creatorWallet: wallet, status: 'claiming', claimedAt: now },
      _sum: { amount: true },
    });
    const totalAmount = claimedSum._sum.amount ?? 0n;

    // Phase 2 — actually move the ETH. (This transfer used to not exist:
    // rows were flipped to 'claimed' and the money never left the pool.)
    let claimTx: string;
    try {
      // Never drain below what open positions need to unwind. A creator claim
      // is not urgent; a position that cannot be sold is. Without this the
      // claim could empty the wallet past sell-gas while positions are open.
      const account = getProtocolAccount();
      const [poolBal, openCount] = await Promise.all([
        getNativeBalance(account.address),
        prisma.position.count({ where: { status: { in: ['open', 'opening', 'closing'] } } }),
      ]);
      const reserve = poolReserveFor(openCount);
      if (poolBal < totalAmount + reserve) {
        throw new InsufficientFundsError(
          `The pool cannot release ${(Number(totalAmount) / 1e18).toFixed(6)} ETH right now without ` +
          `dropping below the reserve it needs to close ${openCount} open position(s). ` +
          `Your payout stays claimable — try again shortly.`,
        );
      }
      claimTx = await transferNative(account, wallet, totalAmount);
    } catch (xferErr) {
      // Transfer failed — release the batch so the creator can retry.
      await prisma.creatorPayout.updateMany({
        where: { creatorWallet: wallet, status: 'claiming', claimedAt: now },
        data: { status: 'claimable', claimedAt: null },
      });
      console.error(`[creator] claim transfer failed for ${wallet}:`, xferErr);
      throw new ValidationError(
        `ETH transfer failed: ${xferErr instanceof Error ? xferErr.message : 'network error'}. Your payouts are still claimable — try again.`,
      );
    }

    // Phase 3 — settle: mark claimed with the real tx + ledger the outflow.
    // Retried; if every attempt fails the rows stay 'claiming' with the ETH
    // already sent — logged CRITICAL for manual reconciliation (never
    // released back to claimable, which would allow a double-claim).
    let settled = false;
    for (let i = 0; i < 5 && !settled; i++) {
      try {
        await prisma.$transaction([
          prisma.creatorPayout.updateMany({
            where: { creatorWallet: wallet, status: 'claiming', claimedAt: now },
            data: { status: 'claimed', claimTx },
          }),
          prisma.poolLedger.create({
            data: { type: 'creator_payout', amount: -totalAmount, txHash: claimTx },
          }),
        ]);
        settled = true;
      } catch {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    if (!settled) {
      console.error(`[creator] CRITICAL: claim ${claimTx} paid ${totalAmount} wei to ${wallet} but settlement failed — rows left 'claiming'`);
    }

    sendSuccess(res, {
      claimedAmount: String(totalAmount),
      payoutCount: claimed.count,
      claimTx,
      message: `${(Number(totalAmount) / 1e18).toFixed(4)} ETH sent to your wallet.`,
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
