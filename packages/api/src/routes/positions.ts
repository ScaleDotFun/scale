// ──────────────────────────────────────────────
// SCALE PROTOCOL — Position Routes (Robinhood Chain / Uniswap V3)
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
  LAMPORTS_PER_SOL,
  type Tier,
} from '@front-protocol/core';
import {
  swapEthForToken,
  swapTokenForEth,
  getProtocolAccount,
  hasEvmProtocolKey,
  loadCustodialWallet,
  getEthBalance,
  erc20Decimals,
  transferEth,
} from '@front-protocol/evm';
import { fetchToken as gtFetchToken, fetchEthUsd } from '../lib/geckoterminal';
import { positionPriceToUsd } from '../lib/priceUnits';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { tradingLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';
import { captureError, trackFinancialOp } from '../lib/monitor';

const router = Router();

/**
 * POST /positions/open
 *
 * Open a new leveraged position. Validates params against tier rules and pool balance,
 * creates the position record, and returns a preview.
 * Swaps execute on Robinhood Chain via Uniswap V3 (SwapRouter02).
 */
router.post(
  '/open',
  verifyWalletSignature,
  tradingLimiter,
  async (req, res) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const wallet = authReq.wallet!;
      const { tokenAddress, leverage, slippageBps } = req.body;
      // Accept both field names — frontend sends capitalLamports
      const userCapitalLamports = req.body.userCapitalLamports ?? req.body.capitalLamports;

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
      let userCapital: bigint;
      try {
        userCapital = BigInt(userCapitalLamports);
      } catch {
        throw new ValidationError('Invalid capital amount — must be a numeric string');
      }

      // Pool capacity — the ledger is internal accounting and can drift
      // from reality; the protocol wallet's REAL balance is what will
      // actually fund the swap. Validate against the smaller of the two
      // so we never approve a position the wallet cannot fill.
      const [poolAgg, onchain] = await Promise.all([
        prisma.poolLedger.aggregate({ _sum: { amount: true } }),
        (await import('../lib/onchain')).getOnchainStats(),
      ]);
      const ledgerBalance = poolAgg._sum.amount ?? 0n;
      const poolBalance = onchain
        ? (BigInt(onchain.poolWalletLamports) < ledgerBalance
            ? BigInt(onchain.poolWalletLamports)
            : ledgerBalance)
        : ledgerBalance;

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

      // ── Optional take-profit / stop-loss (price move %, vs entry) ──
      const takeProfitPct = req.body.takeProfitPct != null ? Number(req.body.takeProfitPct) : null;
      const stopLossPct = req.body.stopLossPct != null ? Number(req.body.stopLossPct) : null;
      if (takeProfitPct != null && (!Number.isFinite(takeProfitPct) || takeProfitPct <= 0 || takeProfitPct > 100000)) {
        throw new ValidationError('takeProfitPct must be a positive percentage');
      }
      // Liquidation fires at |exitThreshold| / leverage in price terms —
      // a stop loss looser than that would never trigger
      const liqPriceMovePct = Math.abs(Number(exitThreshold)) / Number(leverage);
      if (stopLossPct != null) {
        if (!Number.isFinite(stopLossPct) || stopLossPct <= 0 || stopLossPct >= 100) {
          throw new ValidationError('stopLossPct must be between 0 and 100');
        }
        if (stopLossPct >= liqPriceMovePct) {
          throw new ValidationError(
            `Stop loss must be tighter than liquidation (−${liqPriceMovePct.toFixed(1)}% price move at ${leverage}x)`,
          );
        }
      }

      // Safety validation — slippage risk + liquidity depth check
      // Real ETH price + token liquidity from GeckoTerminal (Robinhood Chain)
      let ethPriceUsd = 0;
      let liquidityUsd = 0;
      let tokenSupply = 0;
      let tokenPriceUsd = 0;

      try {
        const [ethUsd, gtToken] = await Promise.all([
          fetchEthUsd(),
          gtFetchToken(tokenAddress),
        ]);
        ethPriceUsd = ethUsd;
        liquidityUsd = gtToken.liquidity;
        tokenPriceUsd = gtToken.price;
        tokenSupply = gtToken.supply;
      } catch (mktErr) {
        console.warn('[positions] GeckoTerminal lookup failed:', mktErr instanceof Error ? mktErr.message : mktErr);
      }
      if (ethPriceUsd <= 0 || tokenPriceUsd <= 0) {
        throw new ValidationError(
          'Cannot price this token right now — market data unavailable. Try again shortly.',
        );
      }

      // ── 3% supply cap ──
      // Protocol max buy = less than 3% of the token's total supply
      if (tokenSupply > 0 && tokenPriceUsd > 0 && ethPriceUsd > 0) {
        const maxBuyUsd = tokenSupply * tokenPriceUsd * 0.03; // 3% of supply value
        const positionEth = Number(positionSize) / 1e18;
        const positionUsd = positionEth * ethPriceUsd;
        if (positionUsd > maxBuyUsd) {
          throw new ValidationError(
            `Position too large — would buy more than 3% of token supply. ` +
            `Max position: ~${(maxBuyUsd / ethPriceUsd).toFixed(4)} ETH`
          );
        }
      }

      const safetyCheck = validatePositionSafety(
        userCapital,
        Number(leverage),
        poolBalance,
        liquidityUsd,
        ethPriceUsd,
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
      const userAccount = loadCustodialWallet(user.encryptedKey);
      if (!hasEvmProtocolKey()) {
        throw new ValidationError(
          'Protocol pool wallet is not configured for Robinhood Chain yet — trading is paused.',
        );
      }
      const protocolAccount = getProtocolAccount();

      // 2. Check user has enough ETH balance
      const userBalance = await getEthBalance(wallet);
      if (userBalance < userCapital) {
        throw new ValidationError(
          `You don't have enough ETH. Your balance is ${(Number(userBalance) / 1e18).toFixed(6)} ETH ` +
          `but this position requires ${(Number(userCapital) / 1e18).toFixed(6)} ETH. ` +
          `Deposit more ETH to your account wallet first.`,
        );
      }

      // 3. Transfer user's ETH collateral to protocol wallet
      const transferSig = await transferEth(userAccount, protocolAccount.address, userCapital);
      console.log(`[positions] User ETH collateral transferred to protocol: ${transferSig}`);

      // 4. Execute Uniswap V3 swap — buy tokens with full position size (user + protocol capital)
      const slippage = Number(slippageBps) || 150; // default 1.5% slippage (bps)
      let openTx: string | undefined;
      let tokensBought: bigint | undefined;
      let entryPrice: number | undefined;

      try {
        // Slippage floor from GeckoTerminal price: expected tokens out, minus slippage
        const decimals = await erc20Decimals(tokenAddress);
        const positionEth = Number(positionSize) / 1e18;
        const expectedTokens = (positionEth * ethPriceUsd) / tokenPriceUsd;
        const expectedRaw = BigInt(Math.floor(expectedTokens * Math.pow(10, decimals)));
        const minOut = (expectedRaw * BigInt(10_000 - slippage - 100)) / 10_000n; // extra 1% for pool fee

        const swapResult = await swapEthForToken(
          protocolAccount,
          tokenAddress,
          positionSize, // full leveraged amount, in wei
          minOut > 0n ? minOut : 1n,
        );

        openTx = swapResult.txHash;
        tokensBought = swapResult.amountOut;

        // Entry price: wei spent per raw token unit
        entryPrice = Number(positionSize) / Number(tokensBought);

        console.log(
          `[positions] Uniswap V3 swap executed: ${openTx} | tokens=${tokensBought} | entryPrice=${entryPrice}`,
        );
      } catch (swapErr) {
        // Swap failed — refund user's ETH
        console.error(`[positions] Uniswap V3 swap failed, refunding user:`, swapErr);
        let refundSuccess = false;
        try {
          await transferEth(protocolAccount, userAccount.address, userCapital);
          refundSuccess = true;
        } catch (refundErr) {
          console.error(`[positions] CRITICAL: Refund failed!`, refundErr);
        }
        throw new ValidationError(
          refundSuccess
            ? `Token swap failed: ${swapErr instanceof Error ? swapErr.message : 'Unknown error'}. Your ETH has been refunded.`
            : `Token swap failed and automatic refund also failed. Please contact support to recover your ${Number(userCapital) / 1e18} ETH.`,
        );
      }

      // 5. Create position record + pool ledger atomically
      const position = await prisma.$transaction(async (tx) => {
        const pos = await tx.position.create({
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
            takeProfitPct: takeProfitPct,
            stopLossPct: stopLossPct,
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
        await tx.poolLedger.create({
          data: {
            type: 'position_open',
            amount: -protocolCapital,
            referenceId: pos.id,
          },
        });

        return pos;
      });

      sendSuccess(res, {
        position: {
          id: position.id,
          userWallet: position.userWallet,
          token: position.token,
          status: position.status,
          userCapital: position.userCapital.toString(),
          protocolCapital: position.protocolCapital.toString(),
          leverage: Number(position.leverage),
          flatFee: position.flatFee.toString(),
          tier: position.tier,
          exitThreshold: String(position.exitThreshold),
          entryPrice: position.entryPrice ? String(position.entryPrice) : null,
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
 * Close an open position: sell tokens via Uniswap V3, calculate P&L,
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
      if (!position.entryPrice || !position.tokensBought) {
        throw new ValidationError('Position missing entry data — cannot close');
      }

      // Atomically set status to 'closing' — prevents concurrent close attempts (double-spend)
      const updated = await prisma.position.updateMany({
        where: { id: positionId, status: 'open' },
        data: { status: 'closing' },
      });
      if (updated.count === 0) {
        throw new ValidationError(`Position is already ${position.status} or being closed`);
      }

      const entryPrice = Number(position.entryPrice);
      const tokensBought = position.tokensBought;
      const userCapitalLamports = position.userCapital;
      const protocolCapitalLamports = position.protocolCapital;
      const tier = position.tier as Tier;
      if (!hasEvmProtocolKey()) {
        await prisma.position.update({ where: { id: positionId }, data: { status: 'open' } });
        throw new ValidationError(
          'Protocol pool wallet is not configured for Robinhood Chain yet — closing is paused.',
        );
      }
      const protocolAccount = getProtocolAccount();

      // 1. Sell tokens via Uniswap V3
      const slippage = Number(req.body.slippageBps) || 200; // default 2% for sells (bps)
      let closeTx: string;
      let solReceived: bigint; // wei of ETH received (legacy field name)

      try {
        // Slippage floor: expected ETH out from GeckoTerminal price, minus slippage
        let minOutWei = 1n;
        try {
          const [ethUsd, gtToken, decimals] = await Promise.all([
            fetchEthUsd(),
            gtFetchToken(position.token.address),
            erc20Decimals(position.token.address),
          ]);
          if (ethUsd > 0 && gtToken.price > 0) {
            const tokensHuman = Number(tokensBought) / Math.pow(10, decimals);
            const expectedEth = (tokensHuman * gtToken.price) / ethUsd;
            const expectedWei = BigInt(Math.floor(expectedEth * 1e18));
            const floor = (expectedWei * BigInt(10_000 - slippage - 100)) / 10_000n; // extra 1% pool fee
            if (floor > 0n) minOutWei = floor;
          }
        } catch {
          // price source down — fall back to minimal floor; swap still reverts on manipulation via pool state
        }

        const sellResult = await swapTokenForEth(
          protocolAccount,
          position.token.address,
          tokensBought,
          minOutWei,
        );
        closeTx = sellResult.txHash;
        solReceived = sellResult.amountOut;

        console.log(
          `[positions] Sold tokens: ${closeTx} | received=${solReceived} wei`,
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
        userLockLamports = totalProfitLamports - userCashProfitLamports; // 30% locked in $SCALE
      }

      // What goes back to user: their original capital + 70% profit - flat fee
      const userReturnLamports = isProfitable
        ? userCapitalLamports + userCashProfitLamports - flatFeeLamports
        : (solReceived > protocolCapitalLamports + flatFeeLamports
            ? solReceived - protocolCapitalLamports - flatFeeLamports
            : 0n); // user lost everything

      // Protocol gets back: their capital + pool's share of the flat fee
      // (flat fee is split: 30% creator + 20% burn + 50% pool — pool share IS the protocol revenue)
      const protocolReturnLamports = protocolCapitalLamports + poolReturnLamports;

      // Determine status
      const finalStatus = isProfitable ? 'closed_profit' : 'closed_loss';

      // 3. Transfer user's ETH back to their wallet
      if (userReturnLamports > 0n) {
        try {
          await transferEth(protocolAccount, wallet, userReturnLamports);
          console.log(`[positions] Returned ${Number(userReturnLamports) / 1e18} ETH to user ${wallet}`);
        } catch (returnErr) {
          captureError(returnErr instanceof Error ? returnErr : new Error(String(returnErr)), {
            userId: wallet,
            positionId,
            action: 'eth_return_failed',
            metadata: { amountLamports: userReturnLamports.toString() },
          });
          console.error(`[positions] CRITICAL: Failed to return ETH to user:`, returnErr);
          // Revert position status so funds can be recovered on retry
          await prisma.position.update({
            where: { id: positionId },
            data: { status: 'open' },
          });
          throw new ValidationError(
            'Failed to return ETH to your wallet. Position has been reverted to open. Please try again.',
          );
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

      const pnlSol = Number(totalProfitLamports) / 1e18; // ETH (legacy field name)
      console.log(
        `[positions] Position #${positionId} closed as ${finalStatus} | P&L: ${pnlSol.toFixed(6)} ETH`,
      );

      sendSuccess(res, {
        id: closedPosition.id,
        status: closedPosition.status,
        message: `Position closed. ${isProfitable ? `Profit: +${pnlSol.toFixed(6)} ETH` : `Loss: ${pnlSol.toFixed(6)} ETH`}`,
        token: closedPosition.token,
        pnlSol: pnlSol.toFixed(6),
        userReturn: (Number(userReturnLamports) / 1e18).toFixed(6),
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
        take: 50,
      });

      // Augment each position with computed live P&L fields
      const enriched = await Promise.all(positions.map(async (pos) => {
        const entryPrice = pos.entryPrice ? Number(pos.entryPrice) : null;
        const openedAtMs = pos.openedAt.getTime();
        const now = Date.now();
        const timeRemainingMs = Math.max(0, openedAtMs + 24 * 60 * 60 * 1000 - now);
        // Booked in wei-per-raw-unit; the UI charts token-USD — convert
        // server-side (null when ETH/USD or decimals are unavailable)
        const entryPriceUsd = await positionPriceToUsd(entryPrice, pos.token.address);

        return {
          id: pos.id,
          userWallet: pos.userWallet,
          token: pos.token,
          status: pos.status,
          userCapital: String(pos.userCapital),
          protocolCapital: String(pos.protocolCapital),
          leverage: Number(pos.leverage),
          flatFee: String(pos.flatFee),
          tier: pos.tier,
          entryPrice: pos.entryPrice ? String(pos.entryPrice) : null,
          entryPriceUsd,
          exitThreshold: String(pos.exitThreshold),
          takeProfitPct: pos.takeProfitPct != null ? Number(pos.takeProfitPct) : null,
          stopLossPct: pos.stopLossPct != null ? Number(pos.stopLossPct) : null,
          tokensBought: pos.tokensBought ? String(pos.tokensBought) : null,
          openedAt: pos.openedAt,
          timeRemainingMs,
          // Live P&L must be calculated with real-time price data from the frontend or services
          livePnLPercent: null as number | null,
        };
      }));

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
        status: { in: ['closed_profit', 'closed_loss', 'liquidated', 'timed_out'] },
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
        userCapital: String(pos.userCapital),
        protocolCapital: String(pos.protocolCapital),
        leverage: Number(pos.leverage),
        flatFee: String(pos.flatFee),
        tier: pos.tier,
        entryPrice: pos.entryPrice ? String(pos.entryPrice) : null,
        exitPrice: pos.exitPrice ? String(pos.exitPrice) : null,
        tokensBought: pos.tokensBought ? String(pos.tokensBought) : null,
        pnlSol: pos.pnlSol ? String(pos.pnlSol) : null,
        userProfit: pos.userProfit ? String(pos.userProfit) : null,
        protocolRevenue: pos.protocolRevenue ? String(pos.protocolRevenue) : null,
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
