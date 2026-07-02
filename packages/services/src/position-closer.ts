// ──────────────────────────────────────────────
// FRONT PROTOCOL — Position Closer Worker
// ──────────────────────────────────────────────
//
// Processes position close jobs: calculates final P&L, distributes revenue,
// updates the position record, and dispatches downstream jobs (burn, lock, payout).
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import {
  calculatePnL,
  calculateFullDistribution,
  splitRevenue,
  calculateInsuranceDeposit,
  calculateInsuranceFundTarget,
  LAMPORTS_PER_SOL,
  formatSol,
  type Tier,
  type PositionStatus,
} from '@front-protocol/core';
import {
  swapTokenToSol,
  getProtocolWallet,
  transferSol,
} from '@front-protocol/solana';
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
  reason: 'threshold' | 'timeout' | 'user';
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
 * Sell tokens back to SOL via Jupiter.
 */
async function executeTokenSell(
  tokenAddress: string,
  tokensBought: bigint,
): Promise<{ solReceived: bigint; txSignature: string }> {
  const protocolWallet = getProtocolWallet();

  console.log(
    `${PREFIX} Selling ${tokensBought} tokens of ${tokenAddress} via Jupiter`,
  );

  const result = await swapTokenToSol(
    tokenAddress,
    tokensBought,
    200, // 2% slippage for liquidation sells
    protocolWallet,
  );

  console.log(
    `${PREFIX} Sell complete: received ${result.solReceived} lamports, tx=${result.txSignature}`,
  );

  return {
    solReceived: result.solReceived,
    txSignature: result.txSignature,
  };
}

/**
 * Process a position close job.
 *
 * Profit distribution:
 *   70% of profit → SOL directly to user
 *   30% of profit → auto-buy $FRONT, locked 7 days, claimable by user
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

    // Sell tokens via Jupiter to get actual SOL back
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

    // Transfer user's SOL return to their wallet
    if (userReturnLamports > 0n) {
      try {
        const protocolWallet = getProtocolWallet();
        await transferSol(protocolWallet, position.userWallet, userReturnLamports);
        console.log(`${PREFIX} Returned ${Number(userReturnLamports) / 1e9} SOL to user ${position.userWallet}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} CRITICAL: Failed to return SOL to user: ${msg}`);
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

    // Burn job — buy back & burn $FRONT with 20% of flat fee revenue
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

    // Lock job — 30% of profit -> buy $FRONT & lock 7 days for user
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
        `P&L: ${formatSol(totalProfitLamports)} SOL | ` +
        `Revenue: ${formatSol(flatFeeLamports)} SOL | ` +
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


