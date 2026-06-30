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
  calculatePnL,
  calculateFullDistribution,
  LAMPORTS_PER_SOL,
  type Tier,
} from '@front-protocol/core';
import {
  swapSolToToken,
  swapTokenToSol,
  getProtocolWallet,
  loadBotWallet,
  getSolBalance,
  getTokenBalance,
  transferSol,
  getConnection,
  SOL_MINT,
} from '@front-protocol/solana';
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

      // Check for duplicate open position on same token
      const existingPosition = await prisma.position.findFirst({
        where: {
          userWallet: wallet,
          tokenId: token.id,
          status: { in: ['open', 'closing'] },
        },
      });
      if (existingPosition) {
        throw new ValidationError(
          `You already have an open position on ${token.symbol}. Close it before opening a new one.`,
        );
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

      // ── On-chain execution ──────────────────────────
      // 1. Load user's custodial wallet keypair
      const user = await prisma.user.findFirst({
        where: { walletAddress: wallet },
        select: { encryptedKey: true },
      });
      if (!user) {
        throw new ValidationError('User wallet not found');
      }
      const userKeypair = loadBotWallet(user.encryptedKey);

      // 2. Check user has enough SOL balance
      const userBalance = await getSolBalance(wallet);
      if (userBalance < userCapital) {
        throw new ValidationError(
          `Insufficient SOL balance. You have ${Number(userBalance) / 1e9} SOL but need ${Number(userCapital) / 1e9} SOL`,
        );
      }

      // 3. Transfer user's SOL collateral to protocol wallet
      const protocolWallet = getProtocolWallet();
      const transferSig = await transferSol(userKeypair, protocolWallet.publicKey, userCapital);
      console.log(`[positions] User SOL transferred to protocol: ${transferSig}`);

      // 4. Execute Jupiter swap — buy tokens with full position size (user + protocol capital)
      const slippage = Number(slippageBps) || 150; // default 1.5% slippage
      let openTx: string | undefined;
      let tokensBought: bigint | undefined;
      let entryPrice: number | undefined;

      try {
        const swapResult = await swapSolToToken(
          positionSize, // full leveraged amount
          tokenAddress,
          slippage,
          protocolWallet,
        );

        openTx = swapResult.txSignature;
        tokensBought = swapResult.tokensReceived;

        // Calculate entry price: SOL spent / tokens received
        entryPrice = Number(positionSize) / Number(tokensBought);

        console.log(
          `[positions] Jupiter swap executed: ${openTx} | tokens=${tokensBought} | entryPrice=${entryPrice}`,
        );
      } catch (swapErr) {
        // Swap failed — refund user's SOL
        console.error(`[positions] Jupiter swap failed, refunding user:`, swapErr);
        try {
          await transferSol(protocolWallet, userKeypair.publicKey, userCapital);
        } catch (refundErr) {
          console.error(`[positions] CRITICAL: Refund failed!`, refundErr);
        }
        throw new ValidationError(
          `Token swap failed: ${swapErr instanceof Error ? swapErr.message : 'Unknown error'}. Your SOL has been refunded.`,
        );
      }

      // 5. Create position record with on-chain data
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
          entryPrice: entryPrice,
          tokensBought: tokensBought,
          openTx: openTx,
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
          userCapital: position.userCapital.toString(),
          protocolCapital: position.protocolCapital.toString(),
          leverage: position.leverage,
          flatFee: position.flatFee.toString(),
          tier: position.tier,
          exitThreshold: position.exitThreshold,
          entryPrice: position.entryPrice,
          tokensBought: position.tokensBought?.toString(),
          openTx: position.openTx,
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
 * Close an open position: sell tokens via Jupiter, calculate P&L,
 * distribute profits, and return capital.
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
            select: { id: true, address: true, name: true, symbol: true, creatorWallet: true, totalTradingVolume: true },
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

      if (!position.entryPrice || !position.tokensBought) {
        throw new ValidationError('Position missing entry data — cannot close');
      }

      // Set status to 'closing' immediately to prevent concurrent close attempts
      await prisma.position.update({
        where: { id: positionId },
        data: { status: 'closing' },
      });

      const entryPrice = Number(position.entryPrice);
      const tokensBought = position.tokensBought;
      const userCapitalLamports = position.userCapital;
      const protocolCapitalLamports = position.protocolCapital;
      const tier = position.tier as Tier;
      const protocolWallet = getProtocolWallet();

      // 1. Sell tokens via Jupiter
      const slippage = Number(req.body.slippageBps) || 200; // default 2% for sells
      let closeTx: string;
      let solReceived: bigint;

      try {
        const sellResult = await swapTokenToSol(
          position.token.address,
          tokensBought,
          slippage,
          protocolWallet,
        );
        closeTx = sellResult.txSignature;
        solReceived = sellResult.solReceived;

        console.log(
          `[positions] Sold tokens: ${closeTx} | received=${solReceived} lamports`,
        );
      } catch (sellErr) {
        // Revert status back to open so user can retry
        await prisma.position.update({
          where: { id: positionId },
          data: { status: 'open' },
        });
        console.error(`[positions] Token sell failed:`, sellErr);
        throw new ValidationError(
          `Failed to sell tokens: ${sellErr instanceof Error ? sellErr.message : 'Unknown error'}`,
        );
      }

      // 2. Calculate P&L from actual swap result
      const exitPrice = Number(solReceived) / Number(tokensBought);
      const positionSize = userCapitalLamports + protocolCapitalLamports;

      // Actual P&L: solReceived - totalCapitalDeployed
      const totalProfitLamports = solReceived - positionSize;
      const isProfitable = totalProfitLamports > 0n;
      const flatFeeLamports = position.flatFee;

      // Revenue distribution from flat fee
      const creatorPayoutLamports = (flatFeeLamports * 30n) / 100n;  // 30% to creator
      const burnAmountLamports = (flatFeeLamports * 20n) / 100n;     // 20% burned
      const poolReturnLamports = flatFeeLamports - creatorPayoutLamports - burnAmountLamports; // 50% to pool

      // User profit distribution
      let userCashProfitLamports = 0n;
      let userLockLamports = 0n;
      if (isProfitable) {
        userCashProfitLamports = (totalProfitLamports * 70n) / 100n;  // 70% cash
        userLockLamports = totalProfitLamports - userCashProfitLamports; // 30% locked in $FRONT
      }

      // What goes back to user: their original capital + 70% profit - flat fee
      const userReturnLamports = isProfitable
        ? userCapitalLamports + userCashProfitLamports - flatFeeLamports
        : (solReceived > protocolCapitalLamports + flatFeeLamports
            ? solReceived - protocolCapitalLamports - flatFeeLamports
            : 0n); // user lost everything

      // Protocol gets back: their capital + fee + pool share
      const protocolReturnLamports = protocolCapitalLamports + flatFeeLamports + poolReturnLamports;

      // Determine status
      const finalStatus = isProfitable ? 'closed_profit' : 'closed_loss';

      // 3. Transfer user's SOL back to their wallet
      if (userReturnLamports > 0n) {
        try {
          await transferSol(protocolWallet, wallet, userReturnLamports);
          console.log(`[positions] Returned ${Number(userReturnLamports) / 1e9} SOL to user ${wallet}`);
        } catch (returnErr) {
          console.error(`[positions] CRITICAL: Failed to return SOL to user:`, returnErr);
        }
      }

      // 4. Update position record with all settlement data
      const closedPosition = await prisma.position.update({
        where: { id: positionId },
        data: {
          status: finalStatus,
          exitPrice: exitPrice,
          pnlSol: totalProfitLamports,
          userProfit: userCashProfitLamports + userLockLamports,
          protocolRevenue: flatFeeLamports,
          creatorPayout: creatorPayoutLamports,
          burnAmount: burnAmountLamports,
          poolReturn: poolReturnLamports,
          lockAmount: userLockLamports,
          closedAt: new Date(),
          closeTx,
        },
        include: {
          token: {
            select: { address: true, name: true, symbol: true },
          },
        },
      });

      // 5. Pool ledger: return protocol capital + pool revenue share
      await prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: protocolCapitalLamports + poolReturnLamports,
          referenceId: positionId,
          txSignature: closeTx,
        },
      });

      // 6. Update token trading volume
      await prisma.token.update({
        where: { id: position.token.id },
        data: {
          totalTradingVolume: position.token.totalTradingVolume + positionSize,
        },
      });

      const pnlSol = Number(totalProfitLamports) / 1e9;
      console.log(
        `[positions] Position #${positionId} closed as ${finalStatus} | P&L: ${pnlSol.toFixed(4)} SOL`,
      );

      sendSuccess(res, {
        id: closedPosition.id,
        status: closedPosition.status,
        message: `Position closed. ${isProfitable ? `Profit: +${pnlSol.toFixed(4)} SOL` : `Loss: ${pnlSol.toFixed(4)} SOL`}`,
        token: closedPosition.token,
        pnlSol: pnlSol.toFixed(6),
        userReturn: (Number(userReturnLamports) / 1e9).toFixed(6),
        closeTx,
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
