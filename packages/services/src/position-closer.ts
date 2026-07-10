// ──────────────────────────────────────────────
// SCALE PROTOCOL — Position Closer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Processes position close jobs: calculates final P&L, distributes revenue,
// updates the position record, and dispatches downstream jobs (burn, lock, payout).
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import {
  calculatePnL,
  calculateFullDistribution,
  splitRevenue,
  calculateInsuranceDeposit,
  calculateInsuranceFundTarget,
  type Tier,
  type PositionStatus,
} from '@scale/core';
import {
  swapTokenForEth,
  getProtocolAccount,
  hasEvmProtocolKey,
  transferEth,
} from '@scale/evm';
import { getTokenPricesEth } from './evm-prices.js';
import {
  redisConnection,
  QUEUE_NAMES,
  burnQueue,
  lockQueue,
  creatorPayoutsQueue,
  insuranceFundQueue,
} from './queues.js';

const PREFIX = '[position-closer]';

interface PositionCloseJobData {
  positionId: number;
  reason: 'threshold' | 'timeout' | 'user' | 'take_profit' | 'stop_loss';
}

/**
 * Determine final position status based on P&L and close reason.
 */
function determineStatus(
  isProfitable: boolean,
  reason: PositionCloseJobData['reason'],
): PositionStatus {
  if (reason === 'timeout') return 'timed_out';
  if (reason === 'threshold' && !isProfitable) return 'liquidated';
  return isProfitable ? 'closed_profit' : 'closed_loss';
}

/**
 * Sell tokens back to ETH via Uniswap V3 on Robinhood Chain.
 * Slippage floor comes from the GeckoTerminal price (3% for liquidation
 * sells + 1% pool fee); if no live price, floor is minimal — the pool
 * itself is the last line of defense.
 */
async function executeTokenSell(
  tokenAddress: string,
  tokensBought: bigint,
): Promise<{ solReceived: bigint; txSignature: string }> {
  if (!hasEvmProtocolKey()) {
    throw new Error('Protocol pool wallet is not configured for Robinhood Chain — cannot sell');
  }
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} Selling ${tokensBought} tokens of ${tokenAddress} via Uniswap V3`,
  );

  let minOutWei = 1n;
  try {
    const prices = await getTokenPricesEth([tokenAddress]);
    const p = prices.get(tokenAddress.toLowerCase());
    if (p && p.weiPerRawUnit > 0) {
      const expectedWei = BigInt(Math.floor(Number(tokensBought) * p.weiPerRawUnit));
      const floor = (expectedWei * 9_600n) / 10_000n; // 3% slippage + 1% pool fee
      if (floor > 0n) minOutWei = floor;
    }
  } catch {
    // price feed down — proceed with minimal floor rather than strand the position
  }

  const result = await swapTokenForEth(
    protocolAccount,
    tokenAddress,
    tokensBought,
    minOutWei,
  );

  console.log(
    `${PREFIX} Sell complete: received ${result.amountOut} wei, tx=${result.txHash}`,
  );

  return {
    solReceived: result.amountOut,
    txSignature: result.txHash,
  };
}

/**
 * Process a position close job.
 *
 * Profit distribution:
 *   70% of profit → ETH directly to user
 *   30% of profit → auto-buy $SCALE, locked 7 days, claimable by user
 *
 * Protocol revenue = flat fee only (split: 30% creator, 20% burn, 50% pool)
 */
async function processPositionClose(job: Job<PositionCloseJobData>): Promise<void> {
  const { positionId, reason } = job.data;
  const startTime = Date.now();
  console.log(`${PREFIX} Closing position #${positionId} (reason: ${reason})`);

  try {
    // Load position with token data
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: {
        token: {
          select: { id: true, address: true, symbol: true, creatorWallet: true, totalTradingVolume: true },
        },
      },
    });

    if (!position) {
      console.error(`${PREFIX} Position #${positionId} not found`);
      return;
    }

    if (position.status !== 'open') {
      console.warn(`${PREFIX} Position #${positionId} already ${position.status}, skipping`);
      return;
    }

    if (!position.entryPrice || !position.tokensBought) {
      console.error(`${PREFIX} Position #${positionId} missing entry price or tokens bought`);
      return;
    }

    const entryPrice = Number(position.entryPrice);
    const tokensBought = position.tokensBought;
    const userCapitalLamports = position.userCapital;
    const protocolCapitalLamports = position.protocolCapital;
    const tier = position.tier as Tier;

    // Sell tokens via Uniswap V3 to get actual ETH back
    const { solReceived, txSignature: closeTx } = await executeTokenSell(
      position.token.address,
      tokensBought,
    );

    // Calculate exit price from actual swap result
    const exitPrice = Number(solReceived) / Number(tokensBought);
    const flatFeeLamports = position.flatFee;

    // Use core PnL calculation
    const pnl = calculatePnL(
      entryPrice,
      exitPrice,
      userCapitalLamports,
      protocolCapitalLamports,
      tier,
    );
    const isProfitable = pnl.isProfitable;
    const totalProfitLamports = pnl.totalProfitLamports;
    const userCashProfitLamports = pnl.userCashoutLamports;
    const userLockLamports = pnl.userLockLamports;

    // Use core revenue split
    const revenue = splitRevenue(flatFeeLamports);
    const creatorPayoutLamports = revenue.creatorPayoutLamports;
    const burnAmountLamports = revenue.burnAmountLamports;
    const poolReturnLamports = revenue.poolReturnLamports;

    // What goes back to user
    const userReturnLamports = isProfitable
      ? userCapitalLamports + userCashProfitLamports - flatFeeLamports
      : (solReceived > protocolCapitalLamports + flatFeeLamports
          ? solReceived - protocolCapitalLamports - flatFeeLamports
          : 0n);

    // Determine final status
    const finalStatus = determineStatus(isProfitable, reason);

    // Transfer user's ETH return to their wallet
    if (userReturnLamports > 0n) {
      try {
        const protocolAccount = getProtocolAccount();
        await transferEth(protocolAccount, position.userWallet, userReturnLamports);
        console.log(`${PREFIX} Returned ${Number(userReturnLamports) / 1e18} ETH to user ${position.userWallet}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} CRITICAL: Failed to return ETH to user: ${msg}`);
        throw err; // Re-throw so BullMQ retries instead of silently losing user funds
      }
    }

    // Persist everything in a transaction
    await prisma.$transaction([
      prisma.position.update({
        where: { id: positionId },
        data: {
          status: finalStatus,
          exitPrice: exitPrice,
          pnlSol: totalProfitLamports,
          userProfit: pnl.userCashoutLamports + pnl.userLockLamports,
          protocolRevenue: pnl.totalProtocolRevenueLamports,
          creatorPayout: creatorPayoutLamports,
          burnAmount: burnAmountLamports,
          poolReturn: poolReturnLamports,
          lockAmount: userLockLamports,
          closedAt: new Date(),
          closeTx,
        },
      }),

      // Pool ledger: return protocol capital + pool share
      prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: protocolCapitalLamports + poolReturnLamports,
          referenceId: positionId,
          txSignature: closeTx,
        },
      }),

      // Update token's total trading volume
      prisma.token.update({
        where: { id: position.token.id },
        data: {
          totalTradingVolume: position.token.totalTradingVolume + userCapitalLamports + protocolCapitalLamports,
        },
      }),
    ]);

    // Dispatch downstream jobs

    // Burn job — buy back & burn $SCALE with 20% of flat fee revenue
    if (burnAmountLamports > 0n) {
      await burnQueue.add(
        'burn-from-position',
        {
          positionId,
          solAmountLamports: burnAmountLamports.toString(),
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    }

    // Lock job — 30% of profit -> buy $SCALE & lock 7 days for user
    if (isProfitable && userLockLamports > 0n) {
      await lockQueue.add(
        'lock-from-position',
        {
          userWallet: position.userWallet,
          solAmountLamports: userLockLamports.toString(),
          positionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    }

    // Creator payout job — 30% of flat fee revenue to token creator
    if (creatorPayoutLamports > 0n) {
      await creatorPayoutsQueue.add(
        'payout-from-position',
        {
          tokenId: position.token.id,
          creatorWallet: position.token.creatorWallet,
          amountLamports: creatorPayoutLamports.toString(),
          positionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    }

    // Insurance fund deposit — calculated based on flat fee and fund target
    // Fetch real balances so we deposit correctly (not over-deposit)
    const [insuranceFundAgg, poolAgg] = await Promise.all([
      prisma.insuranceFund.aggregate({ _sum: { amount: true } }),
      prisma.poolLedger.aggregate({ _sum: { amount: true } }),
    ]);
    const currentInsuranceBalance = insuranceFundAgg._sum.amount ?? 0n;
    const currentPoolBalance = poolAgg._sum.amount ?? 0n;
    // Target = 2% of pool (from INSURANCE_FUND_TARGET_BPS)
    const insuranceTarget = calculateInsuranceFundTarget(currentPoolBalance);

    const insuranceDeposit = calculateInsuranceDeposit(
      flatFeeLamports,
      currentInsuranceBalance,
      insuranceTarget,
    );
    if (insuranceDeposit > 0n) {
      await insuranceFundQueue.add(
        'deposit-from-position',
        {
          type: 'deposit' as const,
          amountLamports: insuranceDeposit.toString(),
          reason: 'position_close_fee',
          positionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Position #${positionId} closed as ${finalStatus} | ` +
        `P&L: ${(Number(totalProfitLamports) / 1e18).toFixed(6)} ETH | ` +
        `Revenue: ${(Number(flatFeeLamports) / 1e18).toFixed(6)} ETH | ` +
        `(${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error closing position #${positionId}: ${msg}`);
    throw err; // Let BullMQ handle retry
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const positionCloserWorker = new Worker<PositionCloseJobData>(
  QUEUE_NAMES.POSITION_CLOSE,
  processPositionClose,
  {
    connection: redisConnection,
    concurrency: 5, // can process multiple closes concurrently
  },
);

positionCloserWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed (position #${job.data.positionId})`);
});

positionCloserWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

positionCloserWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});


