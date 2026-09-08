import { Router } from 'express';
import { prisma } from '@loaded/database';
import { getTierConfig, determineTier, BLOCKED_LIQUIDITY_THRESHOLD_USD, SAFETY_BUFFER_BPS, type Tier } from '@loaded/core';
import {
  erc20TotalSupply,
  verifyCreatorFeeShare,
  findCurveForToken,
  readCurveDeployer,
  getTokenInfo,
  protocolPublicKey,
  isValidAddress,
  getAddress,
  explorerTokenUrl,
  type TokenInfo,
} from '@loaded/evm';
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

/** Admin escape hatch for edge cases (comma-separated token addresses).
 *  Read at call time, like the pool wallet above. */
export function verifiedTokens(): Set<string> {
  return new Set(
    (process.env.LOADED_VERIFIED_TOKENS ?? '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
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

    // Delisted coins stay visible (isActive:false) so traders can see the
    // full history — active coins sort first, and trading stays gated on
    // isActive elsewhere. ?active=true keeps the old active-only behavior.
    const where: Record<string, unknown> =
      req.query.active === 'true' ? { isActive: true } : {};
    if (tierFilter && ['bonded', 'rising', 'degen'].includes(tierFilter)) {
      where.tier = tierFilter;
    }

    const [tokens, total] = await Promise.all([
      prisma.token.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { totalTradingVolume: 'desc' }],
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
        // What the protocol actually closes at: shouldAutoClose adds
        // SAFETY_BUFFER_BPS before comparing, so a UI drawing the liquidation
        // line at the raw threshold promises a price the server never waits for.
        liquidationThresholdPct: (config.exitThresholdBps + SAFETY_BUFFER_BPS) / 100,
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
            flatFeePct: config.flatFeeBps / 100,
            exitThresholdPct: config.exitThresholdBps / 100,
            liquidationThresholdPct: (config.exitThresholdBps + SAFETY_BUFFER_BPS) / 100,
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
        flatFeePct: config.flatFeeBps / 100,
        exitThresholdPct: config.exitThresholdBps / 100,
        liquidationThresholdPct: (config.exitThresholdBps + SAFETY_BUFFER_BPS) / 100,
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
      liquidationThresholdPct: (config.exitThresholdBps + SAFETY_BUFFER_BPS) / 100,
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
 * A creator lists their PONS-launched token on LOADED.
 * Verifies the address is a real ERC-20 on Robinhood Chain, gates on the coin
 * being a launchpad token whose PONS creator fees demonstrably reach the pool
 * wallet, and takes metadata straight from the verification result.
 */
router.post('/list', async (req, res) => {
  try {
    const { tokenAddress } = req.body;

    if (!tokenAddress) {
      throw new ValidationError('tokenAddress is required');
    }

    // Validate token address format (Robinhood Chain — 20-byte 0x hex)
    if (typeof tokenAddress !== 'string' || !isValidAddress(tokenAddress)) {
      throw new ValidationError('Invalid token address — must be a Robinhood Chain (0x…) token address');
    }

    // Addresses are compared case-insensitively everywhere: discovery writes
    // EIP-55 checksummed rows, GeckoTerminal reports lowercase, and a creator
    // pastes whatever their wallet showed them. A byte-for-byte unique index
    // would happily hold the same coin twice under two casings.
    const canonicalAddress = getAddress(tokenAddress.trim());
    const existing = await prisma.token.findFirst({
      where: { address: { equals: canonicalAddress, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ValidationError('Token is already listed');
    }

    // ── On-chain existence check ──
    // The address must be a real ERC-20 on Robinhood Chain (RPC-level proof).
    try {
      await erc20TotalSupply(tokenAddress);
    } catch {
      throw new ValidationError(
        'Token contract not found on Robinhood Chain — is it a real PONS coin? ' +
        `(${explorerTokenUrl(tokenAddress)})`,
      );
    }

    // ── The listing deal — REAL, verified on-chain ──
    // The coin must be a launchpad token AND its PONS creator fee stream must
    // be pointed at the LOADED pool wallet. PONS charges 1% per trade and pays
    // the creator's slice to a single address stored on the coin's bonding
    // curve; we read that address directly. One recipient means redirection is
    // all-or-nothing — there is no partial share to police.
    const LOADED_TOKEN = (process.env.LOADED_TOKEN_MINT || '').trim().toLowerCase();
    const addrKey = canonicalAddress.toLowerCase();
    const pool = poolWalletAddress();
    let feeVerified =
      (addrKey === LOADED_TOKEN && LOADED_TOKEN.length > 0) ||
      verifiedTokens().has(addrKey);
    let tokenInfo: TokenInfo | null = null;
    let isBonded = false;

    if (!feeVerified) {
      if (!pool) {
        throw new ValidationError('Listings are temporarily unavailable — pool wallet not configured.');
      }
      let check;
      try {
        check = await verifyCreatorFeeShare(tokenAddress, pool);
      } catch (err) {
        console.error('[tokens] creator-fee verification failed:', err);
        throw new ValidationError(
          'Could not verify this coin on-chain right now — try again in a minute.',
        );
      }

      const fixIt =
        ` Point your coin's PONS Creator wallet at the LOADED pool wallet ${pool}, ` +
        `then list again — the change takes effect immediately, no trade needed. ` +
        `Guide: loaded.fun/list`;

      switch (check.status) {
        case 'verified':
          feeVerified = true;
          tokenInfo = check.token;
          isBonded = check.graduated;
          console.log(
            `[tokens] creator fees verified for ${tokenAddress} (${check.launchpad}): ${check.detail}`,
          );
          break;
        case 'not_found':
          throw new ValidationError(
            'Token not found on Robinhood Chain — is it a real PONS coin? ' +
            `(${explorerTokenUrl(tokenAddress)})`,
          );
        case 'not_launchpad_token':
          throw new ValidationError(
            'Only PONS launches can be listed on LOADED. Launch on PONS and list again.',
          );
        case 'not_redirected':
          throw new ValidationError(
            'PONS creator fees on this coin are not reaching the LOADED pool wallet.' + fixIt,
          );
        case 'unverifiable':
          console.warn(`[tokens] creator-fee gate inconclusive for ${tokenAddress}: ${check.detail}`);
          throw new ValidationError(
            'Could not read this coin\'s PONS creator fees on-chain right now — try again in a minute.',
          );
      }
    } else {
      // Auto-passed ($LOADED itself or an admin-verified address) — still
      // pull metadata best-effort so the listing isn't blank.
      try {
        tokenInfo = await getTokenInfo(tokenAddress);
      } catch {
        // metadata is best-effort here — defaults apply
      }
    }

    // ── Metadata + tier straight from the verification result ──
    const resolvedName: string | null = tokenInfo?.name || null;
    const resolvedSymbol: string | null = tokenInfo?.symbol || null;
    const resolvedImage: string | null = tokenInfo?.imageUri ?? null;
    const marketCapUsd = tokenInfo?.marketCap ?? 0;
    const liquidityUsd = tokenInfo?.liquidity ?? 0;

    // Determine tier from market data.
    // determineTier returns null for exactly one reason: liquidity is under
    // BLOCKED_LIQUIDITY_THRESHOLD_USD, i.e. "do not trade this". Falling back
    // to 'degen' turned that hard block into a listing, and opened leveraged
    // trading on a book too thin for the pool to exit. Honour the block —
    // but only when the feed actually told us something. A coin so new that
    // it has no market data yet is unknown, not disqualified, and the
    // auto-lister re-tiers it as soon as data appears.
    const tierConfig = determineTier(marketCapUsd, liquidityUsd, isBonded);
    if (!tierConfig && tokenInfo) {
      throw new ValidationError(
        `This coin has $${Math.round(liquidityUsd).toLocaleString()} of liquidity — LOADED needs at least ` +
        `$${BLOCKED_LIQUIDITY_THRESHOLD_USD.toLocaleString()} before it can front capital on it. ` +
        `List again once the pool is deeper.`,
      );
    }
    const resolvedTier: Tier = tierConfig ? tierConfig.tier as Tier : 'degen';

    // The creator on record is the wallet that launched the coin, read off its
    // own bonding curve. It cannot be the fee recipient: once a creator
    // redirects, that recipient IS our pool wallet, so booking payouts against
    // it would make the protocol the beneficiary of its own creator revenue
    // share. Fall back to the pool only when the chain would not tell us.
    // Empty when the chain will not tell us, never the pool wallet: booking the
    // protocol as its own creator turns the 30% revenue share into a liability
    // owed to itself, which is then payable on claim. An empty creatorWallet
    // means no payout is dispatched at all — the honest outcome. Never the
    // token address either; nobody can sign for a token contract.
    let creatorWallet = '';
    try {
      const curve = await findCurveForToken(canonicalAddress);
      const deployer = curve ? await readCurveDeployer(curve) : null;
      if (deployer) creatorWallet = deployer;
      else console.warn(`[tokens] no creator resolved for ${canonicalAddress} — listing with no payee`);
    } catch {
      console.warn(`[tokens] creator lookup failed for ${canonicalAddress} — listing with no payee`);
    }

    // Create token record
    const token = await prisma.token.create({
      data: {
        address: canonicalAddress,
        name: resolvedName,
        symbol: resolvedSymbol,
        imageUri: resolvedImage,
        creatorWallet,
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

