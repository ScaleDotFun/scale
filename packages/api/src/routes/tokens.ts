import { Router } from 'express';
import { prisma } from '@scale/database';
import { getTierConfig, determineTier, type Tier } from '@scale/core';
import {
  splTotalSupply,
  verifyPumpRewardShare,
  getJupToken,
  protocolPublicKey,
  isValidSolanaAddress,
  type JupTokenInfo,
} from '@scale/solana';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError } from '../lib/errors';

/** The protocol pool wallet — the live pool key's pubkey when the key
 *  is installed, else the configured public address, else ''.
 *  Read at call time so env changes and tests behave predictably. */
export function poolWalletAddress(): string {
  return protocolPublicKey() ?? '';
}

/** Admin escape hatch for edge cases (comma-separated base58 mints —
 *  case-sensitive, never lowercased). */
const VERIFIED_TOKENS = new Set(
  (process.env.SCALE_VERIFIED_TOKENS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean),
);

/** Required creator-reward share to the pool wallet (percent, default 100). */
export function minFeeSharePct(): number {
  const raw = Number(process.env.SCALE_MIN_FEE_SHARE_PCT);
  return Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 100;
}

const router = Router();

/**
 * GET /tokens/listed
 *
 * Return all active listed tokens with tier info, paginated.
 * Query params: limit (default 20, max 100), offset (default 0), tier (optional filter)
 */
router.get('/listed', publicLimiter, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const offset = parseInt(req.query.offset as string, 10) || 0;
    const tierFilter = req.query.tier as string | undefined;

    const where: Record<string, unknown> = { isActive: true };
    if (tierFilter && ['bonded', 'rising', 'degen'].includes(tierFilter)) {
      where.tier = tierFilter;
    }

    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        orderBy: { totalTradingVolume: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.token.count({ where }),
    ]);

    const data = tokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        id: token.id,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        creatorWallet: token.creatorWallet,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        flatFeePct: config.flatFeeBps / 100,
        exitThresholdPct: config.exitThresholdBps / 100,
        listedAt: token.listedAt,
        isActive: token.isActive,
        totalTradingVolume: String(token.totalTradingVolume),
        totalCreatorPayouts: String(token.totalCreatorPayouts),
      };
    });

    sendPaginated(res, data, total, limit, offset);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/trending
 *
 * Return top 10 tokens by recent trading volume (last 24h based on positions).
 * Falls back to most recently listed active tokens if no recent trading activity.
 */
router.get('/trending', publicLimiter, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Aggregate recent volume from positions opened in the last 24h
    const recentPositions = await prisma.position.groupBy({
      by: ['tokenId'],
      where: {
        openedAt: { gte: twentyFourHoursAgo },
      },
      _sum: {
        userCapital: true,
        protocolCapital: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          userCapital: 'desc',
        },
      },
      take: 10,
    });

    // If we have recent activity, return volume-based trending
    if (recentPositions.length > 0) {
      const tokenIds = recentPositions.map((rp) => rp.tokenId);
      const tokens = await prisma.token.findMany({
        where: { id: { in: tokenIds }, isActive: true },
      });

      const tokenMap = new Map(tokens.map((t) => [t.id, t]));

      const data = recentPositions
        .map((rp) => {
          const token = tokenMap.get(rp.tokenId);
          if (!token) return null;
          const config = getTierConfig(token.tier as Tier);
          const volume24h = (rp._sum.userCapital ?? 0n) + (rp._sum.protocolCapital ?? 0n);
          return {
            address: token.address,
            name: token.name,
            symbol: token.symbol,
            imageUri: token.imageUri,
            tier: token.tier,
            tierLabel: config.label,
            maxLeverage: config.maxLeverage,
            volume24h: String(volume24h),
            trades24h: rp._count,
            totalTradingVolume: String(token.totalTradingVolume),
          };
        })
        .filter(Boolean);

      return sendSuccess(res, data);
    }

    // Fallback: return listed active tokens ordered by total volume
    const fallbackTokens = await prisma.token.findMany({
      where: { isActive: true },
      orderBy: [{ totalTradingVolume: 'desc' }, { listedAt: 'desc' }],
      take: 10,
    });

    const data = fallbackTokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        volume24h: '0',
        trades24h: 0,
        totalTradingVolume: String(token.totalTradingVolume),
      };
    });

    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/search?q=...
 *
 * Search listed tokens by name, symbol, or address prefix.
 * Returns up to 20 results ordered by total trading volume.
 */
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (q.length < 1) {
      sendSuccess(res, []);
      return;
    }

    const tokens = await prisma.token.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { symbol: { contains: q, mode: 'insensitive' } },
          { address: { startsWith: q } },
        ],
      },
      take: 20,
      orderBy: { totalTradingVolume: 'desc' },
    });

    const data = tokens.map((token) => {
      const config = getTierConfig(token.tier as Tier);
      return {
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        imageUri: token.imageUri,
        tier: token.tier,
        tierLabel: config.label,
        maxLeverage: config.maxLeverage,
        totalTradingVolume: String(token.totalTradingVolume),
      };
    });

    sendSuccess(res, data);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /tokens/:address
 *
 * Return a single token's details including tier config, stats, and creator info.
 */
router.get('/:address', publicLimiter, async (req, res) => {
  try {
    const address = req.params.address as string;

    const token = await prisma.token.findUnique({
      where: { address },
    });

    if (!token) {
      throw new NotFoundError('Token', address);
    }

    const config = getTierConfig(token.tier as Tier);

    // Count active positions for this token
    const activePositions = await prisma.position.count({
      where: { tokenId: token.id, status: 'open' },
    });

    // Recent 24h volume
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentVolume = await prisma.position.aggregate({
      where: {
        tokenId: token.id,
        openedAt: { gte: twentyFourHoursAgo },
      },
      _sum: {
        userCapital: true,
        protocolCapital: true,
      },
      _count: true,
    });

    const volume24h = (recentVolume._sum.userCapital ?? 0n) + (recentVolume._sum.protocolCapital ?? 0n);

    sendSuccess(res, {
      id: token.id,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      imageUri: token.imageUri,
      creatorWallet: token.creatorWallet,
      tier: token.tier,
      tierLabel: config.label,
      maxLeverage: config.maxLeverage,
      flatFeePct: config.flatFeeBps / 100,
      exitThresholdPct: config.exitThresholdBps / 100,
      feeWalletPda: token.feeWalletPda,
      listedAt: token.listedAt,
      isActive: token.isActive,
      totalFeesClaimed: String(token.totalFeesClaimed),
      totalTradingVolume: String(token.totalTradingVolume),
      totalCreatorPayouts: String(token.totalCreatorPayouts),
      activePositions,
      volume24h: String(volume24h),
      trades24h: recentVolume._count,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /tokens/list
 *
 * A creator lists their pump.fun-launched token on SCALE.
 * Verifies the mint is a real SPL token on Solana, gates on Jupiter's
 * launchpad attribution (only genuine pump.fun launches list), and
 * takes metadata straight from the verification result.
 */
router.post('/list', async (req, res) => {
  try {
    const { tokenAddress } = req.body;

    if (!tokenAddress) {
      throw new ValidationError('tokenAddress is required');
    }

    // Validate mint address format (Solana — base58, case-sensitive)
    if (typeof tokenAddress !== 'string' || !isValidSolanaAddress(tokenAddress)) {
      throw new ValidationError('Invalid token address — must be a Solana (base58) mint address');
    }

    // Check if token already listed
    const existing = await prisma.token.findUnique({
      where: { address: tokenAddress },
    });
    if (existing) {
      throw new ValidationError('Token is already listed');
    }

    // ── On-chain existence check ──
    // The mint must be a real SPL token on Solana (RPC-level proof).
    try {
      await splTotalSupply(tokenAddress);
    } catch {
      throw new ValidationError(
        'Token mint not found on Solana — is it a real pump.fun coin? ' +
        `(https://pump.fun/coin/${tokenAddress})`,
      );
    }

    // ── The listing deal — REAL, verified on-chain ──
    // The coin must be a genuine pump.fun launch AND its creator must
    // share creator rewards with the SCALE pool wallet (pump.fun's
    // "Share creator rewards" — read straight from the fee-sharing
    // program's on-chain config, nothing self-reported).
    const SCALE_MINT = (process.env.SCALE_TOKEN_MINT || '').trim();
    const pool = poolWalletAddress();
    const minPct = minFeeSharePct();
    let feeVerified =
      (tokenAddress === SCALE_MINT && SCALE_MINT.length > 0) ||
      VERIFIED_TOKENS.has(tokenAddress);
    let creatorWallet: string | null = null;
    let tokenInfo: JupTokenInfo | null = null;
    let isBonded = false;

    if (!feeVerified) {
      if (!pool) {
        throw new ValidationError('Listings are temporarily unavailable — pool wallet not configured.');
      }
      let check;
      try {
        check = await verifyPumpRewardShare(tokenAddress, pool, minPct);
      } catch (err) {
        console.error('[tokens] reward-share verification failed:', err);
        throw new ValidationError(
          'Could not verify this coin on-chain right now — try again in a minute.',
        );
      }

      const fixIt =
        ` Enable "Share creator rewards" on your pump.fun coin and add the SCALE pool wallet ` +
        `${pool} at ${minPct}%, then list again. Guide: scale.fun/list`;

      switch (check.status) {
        case 'verified':
          feeVerified = true;
          creatorWallet = check.creator ?? null;
          tokenInfo = check.token ?? null;
          isBonded = check.graduated ?? false;
          console.log(
            `[tokens] ✅ reward share verified for ${tokenAddress} (${check.walletPct}% → pool, creator: ${creatorWallet ?? 'unknown'})`,
          );
          break;
        case 'not_found':
          throw new ValidationError(
            'Token not found on Solana — is it a real pump.fun coin? ' +
            `(https://pump.fun/coin/${tokenAddress})`,
          );
        case 'not_pump_token':
          throw new ValidationError(
            'Only pump.fun launches can be listed on SCALE. Launch on pump.fun and list again.',
          );
        case 'not_configured':
          throw new ValidationError('Creator-reward sharing is not enabled for this coin.' + fixIt);
        case 'not_redirected':
          throw new ValidationError('The SCALE pool wallet is not a shareholder of this coin.' + fixIt);
        case 'partial':
          throw new ValidationError(
            `The pool wallet only receives ${check.walletPct}% of creator rewards — ${minPct}% is required.` + fixIt,
          );
      }
    } else {
      // Auto-passed ($SCALE itself or an admin-verified mint) — still
      // pull metadata best-effort so the listing isn't blank.
      try {
        tokenInfo = await getJupToken(tokenAddress);
        isBonded = !!tokenInfo?.graduatedPool || !!tokenInfo?.graduatedAt;
      } catch {
        // metadata is best-effort here — defaults apply
      }
    }

    // ── Metadata + tier straight from the verification result ──
    const resolvedName: string | null = tokenInfo?.name || null;
    const resolvedSymbol: string | null = tokenInfo?.symbol || null;
    const resolvedImage: string | null = tokenInfo?.icon ?? null;
    const marketCapUsd = tokenInfo?.mcap ?? tokenInfo?.fdv ?? 0;
    const liquidityUsd = tokenInfo?.liquidity ?? 0;

    // Determine tier from market data
    const tierConfig = determineTier(marketCapUsd, liquidityUsd, isBonded);
    const resolvedTier: Tier = tierConfig ? tierConfig.tier as Tier : 'degen';

    // Create token record
    const token = await prisma.token.create({
      data: {
        address: tokenAddress,
        name: resolvedName,
        symbol: resolvedSymbol,
        imageUri: resolvedImage,
        creatorWallet: creatorWallet ?? poolWalletAddress(),
        tier: resolvedTier,
        isActive: true,
      },
    });

    const config = getTierConfig(resolvedTier);

    sendSuccess(res, {
      id: token.id,
      address: token.address,
      name: token.name,
      symbol: token.symbol,
      imageUri: token.imageUri,
      creatorWallet: token.creatorWallet,
      tier: token.tier,
      tierLabel: config.label,
      maxLeverage: config.maxLeverage,
      feeVerified,
      marketCapUsd,
      liquidityUsd,
      listedAt: token.listedAt,
      message: 'Token listed successfully',
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;

