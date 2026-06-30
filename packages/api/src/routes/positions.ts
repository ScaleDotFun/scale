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
// Position close is handled inline for now.
// In production with Jupiter swap execution, this would use BullMQ for async processing.
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
      // Fetch real SOL price and token liquidity
      let solPriceUsd = 150;
      let liquidityUsd = 0;

      const BIRDEYE_KEY = process.env.BIRDEYE_API_KEY || '';
      try {
        // Fetch SOL price
        const solPriceRes = await fetch('https://public-api.birdeye.so/defi/price?address=So11111111111111111111111111111111111111112', {
          headers: { 'X-API-KEY': BIRDEYE_KEY, 'x-chain': 'solana' },
        });
        const solPriceData = await solPriceRes.json() as any;
        if (solPriceData?.data?.value) solPriceUsd = solPriceData.data.value;

        // Fetch token liquidity
        const tokenRes = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${tokenAddress}`, {
          headers: { 'X-API-KEY': BIRDEYE_KEY, 'x-chain': 'solana' },
        });
        const tokenData = await tokenRes.json() as any;
        if (tokenData?.data?.liquidity) liquidityUsd = tokenData.data.liquidity;
      } catch {
        // If Birdeye fails, use conservative defaults that block large positions
        solPriceUsd = 150;
        liquidityUsd = 0; // 0 liquidity = safety check will reject
      }

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

      // Close the position directly
      // In production, Jupiter swap would execute here first to sell tokens
      // For now, mark as closed and return protocol capital to pool
      const closedPosition = await prisma.position.update({
        where: { id: positionId },
        data: {
          status: 'closed',
          closedAt: new Date(),
        },
        include: {
          token: {
            select: { address: true, name: true, symbol: true },
          },
        },
      });

      // Return protocol capital to the pool
      await prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: position.protocolCapital,
          referenceId: positionId,
        },
      });

      sendSuccess(res, {
        id: closedPosition.id,
        status: closedPosition.status,
        message: 'Position closed successfully.',
        token: closedPosition.token,
        closedAt: closedPosition.closedAt,
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
