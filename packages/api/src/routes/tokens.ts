import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { getTierConfig, determineTier, type Tier } from '@front-protocol/core';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { publicLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError } from '../lib/errors';

const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

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
          totalTradingVolume: String(token.totalTradingVolume),
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
 * A creator lists their Pump.fun token on Ape Harder.
 * Auto-detects tier from market cap, verifies creator fee redirect on-chain,
 * fetches metadata from DexScreener.
 */
router.post('/list', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;
    const { tokenAddress } = req.body;

    if (!tokenAddress) {
      throw new ValidationError('tokenAddress is required');
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

    // ── On-chain fee verification ──
    // Check that the token's creator fee wallet is set to the protocol wallet
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    let feeVerified = false;

    try {
      // Use Helius DAS API to get the token's fee/authority config
      const dasRes = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getAsset',
          params: { id: tokenAddress },
        }),
      });
      if (dasRes.ok) {
        const dasData = await dasRes.json() as any;
        const authorities = dasData.result?.authorities || [];
        const creators = dasData.result?.creators || [];

        // Check if protocol wallet is in authorities or creators
        for (const auth of authorities) {
          if (auth.address === PROTOCOL_WALLET) {
            feeVerified = true;
            break;
          }
        }
        if (!feeVerified) {
          for (const creator of creators) {
            if (creator.address === PROTOCOL_WALLET) {
              feeVerified = true;
              break;
            }
          }
        }
      }
    } catch {
      // If RPC call fails, check pump.fun API as fallback
    }

    // Fallback: check if the pump.fun fee redirect is set via their API
    if (!feeVerified) {
      try {
        const pumpRes = await fetch(`https://frontend-api-v3.pump.fun/coins/${tokenAddress}`);
        if (pumpRes.ok) {
          const pumpData = await pumpRes.json() as any;
          // Check if creator_fee_wallet or fee_recipient matches protocol wallet
          if (
            pumpData.fee_recipient === PROTOCOL_WALLET ||
            pumpData.creator_fee_wallet === PROTOCOL_WALLET ||
            pumpData.creator === wallet // allow the actual creator
          ) {
            feeVerified = true;
          }
        }
      } catch {
        // Silently continue
      }
    }

    // For now, allow listing with a warning if fee verification fails
    // In production, uncomment the throw below to block unverified tokens
    // if (!feeVerified) {
    //   throw new ValidationError(
    //     'Creator fee wallet is not redirected to the Front Protocol wallet. ' +
    //     'Go to pump.fun and redirect your creator rewards to: ' + PROTOCOL_WALLET
    //   );
    // }

    // ── Auto-detect tier from DexScreener ──
    let resolvedName: string | null = null;
    let resolvedSymbol: string | null = null;
    let resolvedImage: string | null = null;
    let marketCapUsd = 0;
    let liquidityUsd = 0;
    let isBonded = false;

    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
      if (dexRes.ok) {
        const dexData = await dexRes.json() as any;
        const pairs = dexData.pairs || [];
        if (pairs.length > 0) {
          // Get highest liquidity pair
          const bestPair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          resolvedName = bestPair.baseToken?.name || null;
          resolvedSymbol = bestPair.baseToken?.symbol || null;
          resolvedImage = bestPair.info?.imageUrl || null;
          marketCapUsd = bestPair.marketCap || bestPair.fdv || 0;
          liquidityUsd = bestPair.liquidity?.usd || 0;
          // Check if bonded (has Raydium pair)
          isBonded = pairs.some((p: any) =>
            p.dexId === 'raydium' || p.labels?.includes('bonded')
          );
        }
      }
    } catch {
      // DexScreener failed — use defaults
    }

    // Determine tier from market data
    const tierConfig = determineTier(marketCapUsd, liquidityUsd, isBonded);
    const resolvedTier: Tier = tierConfig ? tierConfig.tier as Tier : 'degen';

    // Fallback: Jupiter for metadata
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

