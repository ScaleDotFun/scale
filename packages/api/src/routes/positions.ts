// ──────────────────────────────────────────────
// FRONT PROTOCOL — Position Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import {
  validatePositionOpen,
  validatePositionSafety,
  generatePositionPreview,
  calculateProtocolCapital,
  calculatePositionSize,
  calculateFlatFee,
  getExitThresholdPercent,
  type Tier,
} from '@front-protocol/core';
// Stub: In production this would be a BullMQ queue for async position closing.
// For dev without Redis, we just log and skip.
const positionCloseQueue = {
  add: async (name: string, data: unknown, opts?: unknown) => {
    console.log(`[DEV] Would queue ${name}:`, data);
  },
};
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { tradingLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';

const router = Router();

/**
 * POST /positions/open
 *
 * Open a new leveraged position. Validates params against tier rules and pool balance,
 * creates the position record, and returns a preview.
 * The actual Solana transaction (swap) is handled by the services package.
 */
router.post(
  '/open',
  verifyWalletSignature,
  tradingLimiter,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const wallet = authReq.wallet!;
      const { tokenAddress, userCapitalLamports, leverage, slippageBps } = req.body;

      // Validate required fields
      if (!tokenAddress || userCapitalLamports === undefined || leverage === undefined) {
        throw new ValidationError('Missing required fields', [
          ...(!tokenAddress ? ['tokenAddress is required'] : []),
          ...(userCapitalLamports === undefined ? ['userCapitalLamports is required'] : []),
          ...(leverage === undefined ? ['leverage is required'] : []),
        ]);
      }

      // Find the token
      const token = await prisma.token.findUnique({
        where: { address: tokenAddress },
      });
      if (!token) {
        throw new NotFoundError('Token', tokenAddress);
      }
      if (!token.isActive) {
        throw new ValidationError('Token is not active for trading');
      }

      const tier = token.tier as Tier;
      const userCapital = BigInt(userCapitalLamports);

      // Get current pool balance from ledger
      const poolAgg = await prisma.poolLedger.aggregate({
        _sum: { amount: true },
      });
      const poolBalance = poolAgg._sum.amount ?? 0n;

      // Validate position params
      const validation = validatePositionOpen(
        {
          userWallet: wallet,
          tokenAddress,
          userCapitalLamports: userCapital,
          leverage: Number(leverage),
        },
        tier,
        poolBalance,
      );

      if (!validation.valid) {
        throw new ValidationError('Position validation failed', validation.errors);
      }

      // Calculate position values
      const protocolCapital = calculateProtocolCapital(userCapital, Number(leverage));
      const positionSize = calculatePositionSize(userCapital, Number(leverage));
      const flatFee = calculateFlatFee(positionSize, tier);
      const exitThreshold = getExitThresholdPercent(tier);

      // Safety validation — slippage risk + liquidity depth check
      // Fetch SOL price for safety calculations
      const solPriceUsd = 150; // TODO: fetch from price feed; placeholder for compilation
      const liquidityUsd = 50_000; // TODO: fetch from DexScreener/Jupiter for this token
      const safetyCheck = validatePositionSafety(
        userCapital,
        Number(leverage),
        poolBalance,
        liquidityUsd,
        solPriceUsd,
        tier,
      );
      if (!safetyCheck.safe) {
        throw new ValidationError(safetyCheck.reason || 'Position failed safety validation');
      }

      // Generate preview
      const preview = generatePositionPreview(userCapital, Number(leverage), tier);
      preview.tokenAddress = tokenAddress;

      // Create position record
      const position = await prisma.position.create({
        data: {
          userWallet: wallet,
          tokenId: token.id,
          status: 'open',
          userCapital: userCapital,
          protocolCapital: protocolCapital,
          leverage: Number(leverage),
          flatFee: flatFee,
          tier: tier,
          exitThreshold: exitThreshold,
        },
        include: {
          token: {
            select: {
              address: true,
              name: true,
              symbol: true,
              tier: true,
            },
          },
        },
      });

      // Record pool outflow for protocol capital
      await prisma.poolLedger.create({
        data: {
          type: 'position_open',
          amount: -protocolCapital,
          referenceId: position.id,
        },
      });

      sendSuccess(res, {
        position: {
          id: position.id,
          userWallet: position.userWallet,
          token: position.token,
          status: position.status,
          userCapital: position.userCapital,
          protocolCapital: position.protocolCapital,
          leverage: position.leverage,
          flatFee: position.flatFee,
          tier: position.tier,
          exitThreshold: position.exitThreshold,
          openedAt: position.openedAt,
        },
        preview,
      }, 201);
    } catch (err) {
      sendError(res, err);
    }
  },
);

/**
 * POST /positions/:id/close
 *
 * Mark a position for closing. The actual swap and settlement is
 * handled by the services package asynchronously.
 */
router.post(
  '/:id/close',
  verifyWalletSignature,
  tradingLimiter,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const wallet = authReq.wallet!;
      const positionId = parseInt(req.params.id as string, 10);

      if (isNaN(positionId)) {
        throw new ValidationError('Invalid position ID');
      }

      const position = await prisma.position.findUnique({
        where: { id: positionId },
        include: {
          token: {
            select: { address: true, name: true, symbol: true },
          },
        },
      });

      if (!position) {
        throw new NotFoundError('Position', positionId);
      }
      if (position.userWallet !== wallet) {
        throw new ForbiddenError('You do not own this position');
      }
      if (position.status !== 'open') {
        throw new ValidationError(`Position is already ${position.status}`);
      }

      // Queue a close job — the position-closer worker will:
      //   1. Sell tokens via Jupiter
      //   2. Calculate real P&L
      //   3. Set the correct terminal status
      //   4. Distribute revenue (burn, lock, creator payout)
      await positionCloseQueue.add(
        'close-position',
        { positionId, reason: 'user' as const },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          jobId: `close-user-${positionId}`,
        },
      );

      sendSuccess(res, {
        id: position.id,
        status: 'closing',
        message: 'Position close initiated. Settlement will complete shortly.',
        token: position.token,
      });
    } catch (err) {
      sendError(res, err);
    }
  },
);

/**
 * GET /positions/active
 *
 * Return the authenticated user's open positions with live data.
 */
router.get(
  '/active',
  verifyWalletSignature,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const wallet = authReq.wallet!;

      const positions = await prisma.position.findMany({
        where: {
          userWallet: wallet,
          status: 'open',
        },
        include: {
          token: {
            select: {
              address: true,
              name: true,
              symbol: true,
              tier: true,
            },
          },
        },
        orderBy: { openedAt: 'desc' },
      });

      // Augment each position with computed live P&L fields
      const enriched = positions.map((pos) => {
        const entryPrice = pos.entryPrice ? Number(pos.entryPrice) : null;
        const openedAtMs = pos.openedAt.getTime();
        const now = Date.now();
        const timeRemainingMs = Math.max(0, openedAtMs + 24 * 60 * 60 * 1000 - now);

        return {
          id: pos.id,
          userWallet: pos.userWallet,
          token: pos.token,
          status: pos.status,
          userCapital: pos.userCapital,
          protocolCapital: pos.protocolCapital,
          leverage: pos.leverage,
          flatFee: pos.flatFee,
          tier: pos.tier,
          entryPrice: pos.entryPrice,
          exitThreshold: pos.exitThreshold,
          tokensBought: pos.tokensBought,
          openedAt: pos.openedAt,
          timeRemainingMs,
          // Live P&L must be calculated with real-time price data from the frontend or services
          livePnLPercent: null as number | null,
        };
      });

      sendSuccess(res, enriched);
    } catch (err) {
      sendError(res, err);
    }
  },
);

/**
 * GET /positions/history
 *
 * Return the authenticated user's closed positions with pagination.
 * Query params: limit (default 20), offset (default 0)
 */
router.get(
  '/history',
  verifyWalletSignature,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const wallet = authReq.wallet!;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const where = {
        userWallet: wallet,
        status: { not: 'open' },
      };

      const [positions, total] = await Promise.all([
        prisma.position.findMany({
          where,
          include: {
            token: {
              select: {
                address: true,
                name: true,
                symbol: true,
                tier: true,
              },
            },
          },
          orderBy: { closedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.position.count({ where }),
      ]);

      const data = positions.map((pos) => ({
        id: pos.id,
        userWallet: pos.userWallet,
        token: pos.token,
        status: pos.status,
        userCapital: pos.userCapital,
        protocolCapital: pos.protocolCapital,
        leverage: pos.leverage,
        flatFee: pos.flatFee,
        tier: pos.tier,
        entryPrice: pos.entryPrice,
        exitPrice: pos.exitPrice,
        tokensBought: pos.tokensBought,
        pnlSol: pos.pnlSol,
        userProfit: pos.userProfit,
        protocolRevenue: pos.protocolRevenue,
        openedAt: pos.openedAt,
        closedAt: pos.closedAt,
        closeTx: pos.closeTx,
      }));

      sendPaginated(res, data, total, limit, offset);
    } catch (err) {
      sendError(res, err);
    }
  },
);

export default router;
