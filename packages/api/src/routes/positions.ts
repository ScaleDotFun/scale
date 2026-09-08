// ──────────────────────────────────────────────
// LOADED PROTOCOL — Position Routes (Robinhood Chain)
// ──────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { prisma } from '@loaded/database';
import {
  validatePositionOpen,
  validatePositionSafety,
  generatePositionPreview,
  calculateProtocolCapital,
  calculatePositionSize,
  calculateFlatFee,
  getExitThresholdPercent,
  WEI_PER_ETH,
  type Tier,
} from '@loaded/core';
import {
  swapNativeForToken,
  swapTokenForNative,
  getProtocolAccount,
  hasProtocolKey,
  loadCustodialWallet,
  getNativeBalance,
  getTokenInfo,
  transferNative,
  erc20Balance,
  erc20TotalSupply,
  erc20Decimals,
} from '@loaded/evm';
import { dispatchPostCloseJobs } from '@loaded/services';
import { fetchToken as gtFetchToken, fetchEthUsd } from '../lib/geckoterminal';
import { positionPriceToUsd } from '../lib/priceUnits';
import { awardPositionPoints } from '../lib/points';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { tradingLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import { ValidationError, NotFoundError, ForbiddenError } from '../lib/errors';
import { captureError } from '../lib/monitor';

const router = Router();

/**
 * POST /positions/open
 *
 * Open a new leveraged position. Validates params against tier rules and pool balance,
 * creates the position record, and returns a preview.
 * Swaps execute on Robinhood Chain via the LI.FI aggregator.
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
      // Accept both field names — frontend sends capitalWei
      const userCapitalWei = req.body.userCapitalWei ?? req.body.capitalWei;

      // Validate required fields
      if (!tokenAddress || userCapitalWei === undefined || leverage === undefined) {
        throw new ValidationError('Missing required fields', [
          ...(!tokenAddress ? ['tokenAddress is required'] : []),
          ...(userCapitalWei === undefined ? ['userCapitalWei is required'] : []),
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
          status: { in: ['opening', 'open', 'closing'] },
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
        userCapital = BigInt(userCapitalWei);
      } catch {
        throw new ValidationError('Invalid capital amount — must be a numeric string');
      }

      // Pool capacity — the protocol wallet's REAL on-chain ETH balance is
      // what actually fronts the swap, so that's the gate. The DB ledger
      // is internal accounting and starts empty (no fees yet), so it must
      // never block a position the funded wallet can genuinely fill. Keep
      // a small fee reserve so the pool can always pay for its own txs.
      const [poolAgg, onchain] = await Promise.all([
        prisma.poolLedger.aggregate({ _sum: { amount: true } }),
        (await import('../lib/onchain')).getOnchainStats(),
      ]);
      const ledgerBalance = poolAgg._sum.amount ?? 0n;
      const POOL_GAS_RESERVE = WEI_PER_ETH / 1_000n; // 0.001 ETH — L2 gas is cheap
      const poolBalance = onchain
        ? (BigInt(onchain.poolWalletWei) > POOL_GAS_RESERVE
            ? BigInt(onchain.poolWalletWei) - POOL_GAS_RESERVE
            : 0n)
        : ledgerBalance;

      // Validate position params
      const validation = validatePositionOpen(
        {
          userWallet: wallet,
          tokenAddress,
          userCapitalWei: userCapital,
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
      // Real ETH price + token price/liquidity from the market feed,
      // with GeckoTerminal as fallback.
      let ethPriceUsd = 0;
      let liquidityUsd = 0;
      let tokenSupply = 0;
      let tokenPriceUsd = 0;

      try {
        const [ethUsd, marketToken] = await Promise.all([
          fetchEthUsd(),
          getTokenInfo(tokenAddress),
        ]);
        ethPriceUsd = ethUsd;
        if (marketToken) {
          tokenPriceUsd = marketToken.priceUsd ?? 0;
          liquidityUsd = marketToken.liquidity ?? 0;
          // Supply is not part of the market feed — read it on-chain and
          // scale out of raw units so it is comparable to a USD price.
          try {
            const [raw, decimals] = await Promise.all([
              erc20TotalSupply(tokenAddress),
              erc20Decimals(tokenAddress),
            ]);
            tokenSupply = Number(raw) / Math.pow(10, decimals);
          } catch {
            tokenSupply = 0;
          }
        }
      } catch (mktErr) {
        console.warn('[positions] market lookup failed:', mktErr instanceof Error ? mktErr.message : mktErr);
      }
      if (tokenPriceUsd <= 0) {
        try {
          const gtToken = await gtFetchToken(tokenAddress);
          tokenPriceUsd = gtToken.price;
          if (liquidityUsd <= 0) liquidityUsd = gtToken.liquidity;
          if (tokenSupply <= 0) tokenSupply = gtToken.supply;
        } catch (gtErr) {
          console.warn('[positions] GeckoTerminal fallback failed:', gtErr instanceof Error ? gtErr.message : gtErr);
        }
      }
      // Hard-fail on missing prices — never trade on a made-up number.
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
      // 1. Load the user's custodial wallet
      const user = await prisma.user.findFirst({
        where: { walletAddress: wallet },
        select: { encryptedKey: true },
      });
      if (!user) {
        throw new ValidationError('User wallet not found');
      }
      const userAccount = loadCustodialWallet(user.encryptedKey);
      if (!hasProtocolKey()) {
        throw new ValidationError(
          'Protocol pool wallet is not configured for Robinhood Chain yet — trading is paused.',
        );
      }
      const protocolAccount = getProtocolAccount();

      // 2. Check user has enough ETH balance
      const userBalance = await getNativeBalance(wallet);
      if (userBalance < userCapital) {
        throw new ValidationError(
          `You don't have enough ETH. Your balance is ${(Number(userBalance) / 1e18).toFixed(6)} ETH ` +
          `but this position requires ${(Number(userCapital) / 1e18).toFixed(6)} ETH. ` +
          `Deposit more ETH to your account wallet first.`,
        );
      }

      // 3. Persist INTENT before any money moves. A row in 'opening' status
      // is the recovery anchor: if the process dies or the DB blips at any
      // later step, the reconciliation sweep can see exactly how far this
      // open got (collateralTx? openTx?) and either finish it or refund it.
      // Without this row, funds moved on-chain are invisible to every worker.
      const intent = await prisma.position.create({
        data: {
          userWallet: wallet,
          tokenId: token.id,
          status: 'opening',
          statusChangedAt: new Date(),
          userCapital: userCapital,
          protocolCapital: protocolCapital,
          leverage: Number(leverage),
          flatFee: flatFee,
          tier: tier,
          exitThreshold: exitThreshold,
          takeProfitPct: takeProfitPct,
          stopLossPct: stopLossPct,
        },
      });
      const positionRowId = intent.id;
      const persistMarker = async (data: Record<string, unknown>, label: string) => {
        for (let i = 0; i < 5; i++) {
          try {
            await prisma.position.update({ where: { id: positionRowId }, data });
            return;
          } catch {
            await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
          }
        }
        console.error(`[positions] CRITICAL: could not persist ${label} for position #${positionRowId}`);
      };

      // 4. Transfer user's ETH collateral to protocol wallet
      let transferSig: string;
      // Snapshot first: transferNative also throws when confirmation times out,
      // and in that case the transfer can still land. Deciding "nothing was
      // charged" from the exception alone would tell the user their ETH is safe
      // while the pool has actually absorbed it.
      const balanceBeforeTransfer = await getNativeBalance(userAccount.address).catch(() => null);
      try {
        transferSig = await transferNative(userAccount, protocolAccount.address, userCapital);
      } catch (xferErr) {
        const reason = xferErr instanceof Error ? xferErr.message : 'network error';
        const balanceAfter = await getNativeBalance(userAccount.address).catch(() => null);
        const moved =
          balanceBeforeTransfer !== null &&
          balanceAfter !== null &&
          balanceBeforeTransfer - balanceAfter >= userCapital;

        if (moved) {
          // The collateral really left the user. Keep the row in 'opening' and
          // write a REAL collateralTx marker so the recovery sweep owns it —
          // the sweep decides whether to refund by looking at that field, and a
          // row with no marker is written off as "no funds moved". We have no
          // hash (transferNative threw before returning one), so record the
          // sentinel: it is not an explorer link, it is the fact that the pool
          // was credited. 'failed' is never revisited, so getting this wrong
          // strands the user's ETH in the pool permanently.
          await persistMarker(
            { collateralTx: 'unconfirmed', statusChangedAt: new Date() },
            'collateral-landed marker',
          );
          console.error(
            `[positions] CRITICAL: collateral for #${positionRowId} left the user wallet but confirmation failed (${reason}) — left in 'opening' for recovery`,
          );
          throw new ValidationError(
            'Your collateral was sent but the network did not confirm in time. ' +
            'The position is being reconciled automatically — do not retry; check your history shortly.',
          );
        }

        await persistMarker({ status: 'failed', statusChangedAt: new Date() }, 'failed status');
        throw new ValidationError(
          `Could not transfer your collateral: ${reason}. Nothing was charged.`,
        );
      }
      await persistMarker({ collateralTx: transferSig }, 'collateralTx');
      console.log(`[positions] User ETH collateral transferred to protocol: ${transferSig}`);

      // 4. Execute LI.FI swap — buy tokens with full position size (user + protocol capital)
      const slippage = Number(slippageBps) || 150; // default 1.5% slippage (bps)
      let openTx: string | undefined;
      let tokensBought: bigint | undefined;
      let entryPrice: number | undefined;

      // Snapshot before the swap so a timeout can be distinguished from a
      // genuine failure by asking whether the tokens actually arrived.
      const poolTokensBeforeSwap = await erc20Balance(tokenAddress, protocolAccount.address).catch(() => null);

      try {
        // The minimum-out is quoted inside swapNativeForToken via LI.FI's
        // quote API — real route state, not a mid-price estimate.
        const swapResult = await swapNativeForToken(
          protocolAccount,
          tokenAddress,
          positionSize, // full leveraged amount, in wei
          slippage,     // basis points
        );

        openTx = swapResult.txHash;
        tokensBought = swapResult.amountOut;

        // Entry price: wei spent per raw token unit
        entryPrice = Number(positionSize) / Number(tokensBought);

        console.log(
          `[positions] LI.FI swap executed: ${openTx} | tokens=${tokensBought} | entryPrice=${entryPrice}`,
        );
      } catch (swapErr) {
        // A throw here does NOT prove the swap failed: waitForTransactionReceipt
        // also throws on timeout, and that transaction can still land. Refunding
        // on that assumption would leave the pool holding the tokens AND having
        // paid the user back. Ask the chain before deciding.
        const poolTokensAfter = await erc20Balance(tokenAddress, protocolAccount.address).catch(() => null);
        if (poolTokensAfter !== null && poolTokensBeforeSwap !== null && poolTokensAfter > poolTokensBeforeSwap) {
          console.error(
            `[positions] CRITICAL: swap for #${positionRowId} reported failure but the pool received ` +
            `${poolTokensAfter - poolTokensBeforeSwap} raw tokens — NOT refunding; left in 'opening' for reconciliation`,
          );
          await persistMarker({ statusChangedAt: new Date() }, 'swap-landed marker');
          throw new ValidationError(
            'Your position is being confirmed on-chain — the network did not respond in time. ' +
            'Do not retry; it will appear in your positions shortly.',
          );
        }

        // Nothing arrived — the swap really did not land. Refund and fail.
        console.error(`[positions] LI.FI swap failed, refunding user:`, swapErr);
        let refundSuccess = false;
        let refundSig: string | undefined;
        try {
          refundSig = await transferNative(protocolAccount, userAccount.address, userCapital);
          refundSuccess = true;
        } catch (refundErr) {
          console.error(`[positions] CRITICAL: Refund failed!`, refundErr);
        }
        await persistMarker(
          { status: refundSuccess ? 'failed' : 'opening', userReturnTx: refundSig, statusChangedAt: new Date() },
          'swap-failure state',
        );
        // If the refund also failed, the row stays 'opening' with
        // collateralTx set and no openTx — the recovery sweep refunds it.
        throw new ValidationError(
          refundSuccess
            ? `Token swap failed: ${swapErr instanceof Error ? swapErr.message : 'Unknown error'}. Your ETH has been refunded.`
            : `Token swap failed and the instant refund hit a network error — your ${Number(userCapital) / 1e18} ETH will be auto-refunded within a few minutes.`,
        );
      }
      // Marker: the buy landed — record its signature before settlement so a
      // crash here is recoverable forward (sweep re-derives entry data from
      // the transaction itself).
      await persistMarker({ openTx }, 'openTx');

      // Tripwire: entry data must be sane before the row can go 'open'.
      // (The EVM layer's quote fallback makes this unreachable; if it
      // ever fires, the row stays 'opening' with openTx set and the
      // recovery sweep derives entry data from the transaction itself.)
      if (!tokensBought || tokensBought <= 0n || !entryPrice || !Number.isFinite(entryPrice)) {
        console.error(
          `[positions] CRITICAL: swap ${openTx} confirmed but receipt unverifiable ` +
          `(tokens=${tokensBought}, entry=${entryPrice}) — position #${positionRowId} left in 'opening' for auto-recovery`,
        );
        throw new ValidationError(
          `Swap confirmed on-chain but the token receipt could not be verified yet. ` +
          `Your position will appear automatically within a few minutes.`,
        );
      }

      // 5. Settle: flip the intent row to 'open' + pool ledger atomically.
      // Retried because a transient DB failure here must not orphan a
      // position whose buy already landed; if every retry fails, the row
      // stays 'opening' (with openTx) and the sweep finishes the job.
      let position: (typeof intent & { token: { address: string; name: string | null; symbol: string | null; tier: string | null } }) | null = null;
      let settleErr: unknown;
      for (let i = 0; i < 3 && !position; i++) {
        try {
          position = await prisma.$transaction(async (tx) => {
            const pos = await tx.position.update({
              where: { id: positionRowId },
              data: {
                status: 'open',
                statusChangedAt: new Date(),
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
        } catch (err) {
          settleErr = err;
          await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        }
      }
      if (!position) {
        console.error(`[positions] CRITICAL: settlement failed for #${positionRowId} — left 'opening' for auto-recovery:`, settleErr);
        throw new ValidationError(
          'Your buy executed on-chain but a database hiccup delayed the position record. ' +
          'It will appear automatically within a few minutes — do not re-submit.',
        );
      }

      // Award points on the notional size (non-fatal; never blocks the trade)
      await awardPositionPoints(wallet, position.id, positionSize);

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
 * Close an open position: sell tokens via LI.FI, calculate P&L,
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
        data: { status: 'closing', statusChangedAt: new Date() },
      });
      if (updated.count === 0) {
        throw new ValidationError(`Position is already ${position.status} or being closed`);
      }

      const entryPrice = Number(position.entryPrice);
      const tokensBought = position.tokensBought;
      const userCapitalWei = position.userCapital;
      const protocolCapitalWei = position.protocolCapital;
      const tier = position.tier as Tier;
      if (!hasProtocolKey()) {
        await prisma.position.update({ where: { id: positionId }, data: { status: 'open', statusChangedAt: new Date() } });
        throw new ValidationError(
          'Protocol pool wallet is not configured for Robinhood Chain yet — closing is paused.',
        );
      }
      const protocolAccount = getProtocolAccount();

      // 1. Sell tokens via LI.FI
      const slippage = Number(req.body.slippageBps) || 200; // default 2% for sells (bps)
      let closeTx: string;
      let ethReceived: bigint; // wei of ETH received

      try {
        // minimum-out quoted inside swapTokenForNative via LI.FI's quote API
        const sellResult = await swapTokenForNative(
          protocolAccount,
          position.token.address,
          tokensBought,
          slippage, // basis points
        );
        closeTx = sellResult.txHash;
        ethReceived = sellResult.amountOut;

        console.log(
          `[positions] Sold tokens: ${closeTx} | received=${ethReceived} wei`,
        );
      } catch (sellErr) {
        // The EVM layer now conclusively distinguishes not-landed from
        // landed-but-unconfirmed, so a throw here means nothing moved —
        // reverting to 'open' is safe and lets the user retry.
        await prisma.position.update({
          where: { id: positionId },
          data: { status: 'open', statusChangedAt: new Date() },
        });
        console.error(`[positions] Token sell failed:`, sellErr);
        throw new ValidationError(
          `Failed to sell tokens: ${sellErr instanceof Error ? sellErr.message : 'Unknown error'}`,
        );
      }

      // Marker: the sell is irreversible from here — persist it BEFORE the
      // payout so a crash or payout failure can never lead to a second sell
      // (the recovery sweep finalizes from this marker instead).
      // statusChangedAt is refreshed with it: the reconcile sweep treats a
      // 'closing' row whose statusChangedAt is over a minute old as abandoned
      // and enqueues a finalize. It was last stamped when the close was
      // claimed — before the sell — so a sell that takes longer than that
      // window would have the sweep racing this handler's own payout.
      for (let i = 0; i < 5; i++) {
        try {
          await prisma.position.update({
            where: { id: positionId },
            data: { closeTx, ethReceived, statusChangedAt: new Date() },
          });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
        }
      }

      // 2. Calculate P&L from actual swap result
      const exitPrice = Number(ethReceived) / Number(tokensBought);
      const positionSize = userCapitalWei + protocolCapitalWei;

      // Actual P&L: ethReceived - totalCapitalDeployed
      const totalProfitWei = ethReceived - positionSize;
      const isProfitable = totalProfitWei > 0n;
      const flatFeeWei = position.flatFee;

      // Revenue distribution from flat fee
      const creatorPayoutWei = (flatFeeWei * 30n) / 100n;  // 30% to creator
      const burnAmountWei = (flatFeeWei * 20n) / 100n;     // 20% burned
      const poolReturnWei = flatFeeWei - creatorPayoutWei - burnAmountWei; // 50% to pool

      // User profit distribution
      let userCashProfitWei = 0n;
      let userLockWei = 0n;
      if (isProfitable) {
        userCashProfitWei = (totalProfitWei * 70n) / 100n;  // 70% cash
        userLockWei = totalProfitWei - userCashProfitWei; // 30% locked in $LOADED
      }

      // What goes back to user: their original capital + 70% profit - flat fee
      const userReturnWei = isProfitable
        ? userCapitalWei + userCashProfitWei - flatFeeWei
        : (ethReceived > protocolCapitalWei + flatFeeWei
            ? ethReceived - protocolCapitalWei - flatFeeWei
            : 0n); // user lost everything

      // Protocol gets back: their capital + pool's share of the flat fee
      // (flat fee is split: 30% creator + 20% burn + 50% pool — pool share IS the protocol revenue)
      const protocolReturnWei = protocolCapitalWei + poolReturnWei;

      // Determine status
      const finalStatus = isProfitable ? 'closed_profit' : 'closed_loss';

      // 3. Transfer user's ETH back to their wallet
      if (userReturnWei > 0n) {
        // Reserve the payout slot first. The recovery sweep can enqueue a
        // 'finalize' for this same row while this handler is merely slow, and
        // the closer's payout branch is guarded by `userReturnTx: null` — so
        // without a reservation here both would read null and both would pay
        // the user out of the pool. Claim the slot with a conditional update:
        // only the writer that affects a row is allowed to move money.
        const reservation = `pending:${randomUUID()}`;
        const reserved = await prisma.position.updateMany({
          where: { id: positionId, userReturnTx: null },
          data: { userReturnTx: reservation },
        });
        if (reserved.count === 0) {
          console.warn(`[positions] #${positionId}: payout already reserved elsewhere — not transferring again`);
        } else {
        try {
          const returnSig = await transferNative(protocolAccount, wallet, userReturnWei);
          await prisma.position.update({
            where: { id: positionId },
            data: { userReturnTx: returnSig },
          }).catch(() => { /* marker write is best-effort; settlement below persists state */ });
          console.log(`[positions] Returned ${Number(userReturnWei) / 1e18} ETH to user ${wallet}`);
        } catch (returnErr) {
          captureError(returnErr instanceof Error ? returnErr : new Error(String(returnErr)), {
            userId: wallet,
            positionId,
            action: 'sol_return_failed',
            metadata: { amountWei: userReturnWei.toString() },
          });
          console.error(`[positions] CRITICAL: Failed to return ETH to user:`, returnErr);
          console.error(
            `[positions] payout for #${positionId} left reserved (${reservation}) — verify on-chain ` +
            `whether ${userReturnWei} wei reached ${wallet} before clearing it`,
          );
          // NEVER revert to 'open' here: the sell already landed, so a
          // reverted position would be re-sold on the next close — a double
          // spend from the shared pool. Leave it 'closing' with the closeTx
          // marker set; the recovery sweep pays out and settles forward.
          // The reservation is deliberately NOT released: transferNative also
          // throws on a confirmation timeout, where the ETH can still land.
          throw new ValidationError(
            'Your tokens were sold, but the ETH payout hit a network error. ' +
            'It will complete automatically within a few minutes — no action needed.',
          );
        }
        }
      }

      // 4. Update position record with all settlement data
      const closedPosition = await prisma.position.update({
        where: { id: positionId },
        data: {
          status: finalStatus,
          statusChangedAt: new Date(),
          exitPrice: exitPrice,
          pnlEth: totalProfitWei,
          userProfit: userCashProfitWei + userLockWei,
          protocolRevenue: flatFeeWei,
          creatorPayout: creatorPayoutWei,
          burnAmount: burnAmountWei,
          poolReturn: poolReturnWei,
          lockAmount: userLockWei,
          closedAt: new Date(),
          closeTx,
        },
        include: {
          token: {
            select: { address: true, name: true, symbol: true },
          },
        },
      });

      // 5. Pool ledger: credit what the wallet actually retained from the sale.
      // The creator's 30% and the burn's 20% of the fee are debited later, when
      // they are really paid, so crediting only the pool's 50% here lost the
      // protocol's retained fee revenue on every close.
      await prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: ethReceived - userReturnWei,
          referenceId: positionId,
          txHash: closeTx,
        },
      });

      // 6. Update token trading volume (atomic — concurrent closes on the same
      // coin would otherwise clobber each other's read-modify-write)
      await prisma.token.update({
        where: { id: position.token.id },
        data: {
          totalTradingVolume: { increment: positionSize },
        },
      });

      // 7. Downstream work — identical to the auto-closer. Without this a
      // manual SELL recorded the user's $LOADED lock without ever buying it,
      // never paid the coin's creator, and never burned.
      await dispatchPostCloseJobs({
        positionId,
        burnAmountWei,
        userLockWei,
        isProfitable,
        userWallet: position.userWallet,
        tokenId: position.token.id,
        creatorWallet: position.token.creatorWallet,
        creatorPayoutWei,
        flatFeeWei,
        poolShortfallWei:
          ethReceived - userReturnWei < protocolCapitalWei
            ? protocolCapitalWei - (ethReceived - userReturnWei)
            : 0n,
      });

      const pnlEth = Number(totalProfitWei) / 1e18; // ETH
      console.log(
        `[positions] Position #${positionId} closed as ${finalStatus} | P&L: ${pnlEth.toFixed(6)} ETH`,
      );

      sendSuccess(res, {
        id: closedPosition.id,
        status: closedPosition.status,
        message: `Position closed. ${isProfitable ? `Profit: +${pnlEth.toFixed(6)} ETH` : `Loss: ${pnlEth.toFixed(6)} ETH`}`,
        token: closedPosition.token,
        pnlWei: totalProfitWei.toString(),
        pnlEth: pnlEth.toFixed(6),
        userReturn: (Number(userReturnWei) / 1e18).toFixed(6),
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
        // Booked in wei-per-raw-unit; the UI charts token-USD —
        // convert server-side (null when ETH/USD or decimals are unavailable)
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
        // Named for its unit. The column is called pnlEth but holds WEI, and
        // shipping that name meant the close response's `pnlEth` (a formatted
        // ETH string) and this one (a wei string) collided under one key —
        // every client that read it got one of the two wrong.
        pnlWei: pos.pnlEth ? String(pos.pnlEth) : null,
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
