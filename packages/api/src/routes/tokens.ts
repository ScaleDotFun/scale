// ──────────────────────────────────────────────
// FRONT PROTOCOL — Token Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { getTierConfig, type Tier } from '@front-protocol/core';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError } from '../lib/errors';

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
        totalTradingVolume: token.totalTradingVolume,
        totalCreatorPayouts: token.totalCreatorPayouts,
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

    // Fetch the token details for these IDs
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
          volume24h,
          trades24h: rp._count,
          totalTradingVolume: token.totalTradingVolume,
        };
      })
      .filter(Boolean);

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
        totalTradingVolume: token.totalTradingVolume,
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
      totalFeesClaimed: token.totalFeesClaimed,
      totalTradingVolume: token.totalTradingVolume,
      totalCreatorPayouts: token.totalCreatorPayouts,
      activePositions,
      volume24h,
      trades24h: recentVolume._count,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /tokens/list
 *
 * A creator lists their Pump.fun token on Ape Harder.
 * Validates the creator wallet, checks that the fee redirect exists,
 * and creates the token record.
 */
router.post('/list', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;

    const { tokenAddress, name, symbol, tier, feeWalletPda } = req.body;

    if (!tokenAddress || !tier) {
      throw new ValidationError('Missing required fields', [
        ...(!tokenAddress ? ['tokenAddress is required'] : []),
        ...(!tier ? ['tier is required'] : []),
      ]);
    }

    // Validate tier
    if (!['bonded', 'rising', 'degen'].includes(tier)) {
      throw new ValidationError('Invalid tier. Must be bonded, rising, or degen.');
    }

    // Validate token address format
    if (typeof tokenAddress !== 'string' || tokenAddress.length < 32 || tokenAddress.length > 44) {
      throw new ValidationError('Invalid token address format');
    }

    // Check if token already listed
    const existing = await prisma.token.findUnique({
      where: { address: tokenAddress },
    });
    if (existing) {
      throw new ValidationError('Token is already listed');
    }

    // Auto-fetch token metadata (name, symbol, logo) if not provided
    let resolvedName = name || null;
    let resolvedSymbol = symbol || null;
    let resolvedImage: string | null = null;

    if (!resolvedName || !resolvedSymbol) {
      try {
        // DexScreener has the best coverage for pump.fun tokens
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        if (dexRes.ok) {
          const dexData = await dexRes.json() as {
            pairs?: Array<{ baseToken?: { name?: string; symbol?: string }; info?: { imageUrl?: string } }>;
          };
          const pair = dexData.pairs?.[0];
          if (pair?.baseToken) {
            resolvedName = resolvedName || pair.baseToken.name || null;
            resolvedSymbol = resolvedSymbol || pair.baseToken.symbol || null;
            resolvedImage = pair.info?.imageUrl || null;
          }
        }
      } catch {
        // Silently ignore — metadata is best-effort
      }
    }

    // Fallback: Jupiter token list
    if (!resolvedName || !resolvedSymbol) {
      try {
        const jupRes = await fetch(`https://tokens.jup.ag/token/${tokenAddress}`);
        if (jupRes.ok) {
          const text = await jupRes.text();
          if (text) {
            const meta = JSON.parse(text) as { name?: string; symbol?: string; logoURI?: string };
            resolvedName = resolvedName || meta.name || null;
            resolvedSymbol = resolvedSymbol || meta.symbol || null;
            resolvedImage = resolvedImage || meta.logoURI || null;
          }
        }
      } catch {
        // Silently ignore
      }
    }

    // Create token record
    const token = await prisma.token.create({
      data: {
        address: tokenAddress,
        name: resolvedName,
        symbol: resolvedSymbol,
        imageUri: resolvedImage,
        creatorWallet: wallet,
        tier: tier,
        feeWalletPda: feeWalletPda || null,
        isActive: true,
      },
    });

    const config = getTierConfig(tier as Tier);

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
      listedAt: token.listedAt,
      message: 'Token listed successfully',
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
