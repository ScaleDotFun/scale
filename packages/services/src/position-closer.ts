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
  LAMPORTS_PER_SOL,
  type Tier,
  type PositionStatus,
} from '@front-protocol/core';
import {
  redisConnection,
  QUEUE_NAMES,
  burnQueue,
  lockQueue,
  creatorPayoutsQueue,
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
 * Simulate selling the tokens back to SOL.
 * In production this would execute a Jupiter swap.
 *
 * @returns The actual exit price achieved
 */
async function executeTokenSell(
  tokenAddress: string,
  tokensBought: bigint,
): Promise<{ exitPrice: number; txSignature: string }> {
  // SOLANA: would execute Jupiter swap:
  //   1. Get quote from Jupiter API (api.jup.ag)
  //   2. Execute swap instruction
  //   3. Confirm transaction
  console.log(
    `${PREFIX} SOLANA: would sell ${tokensBought} tokens of ${tokenAddress} via Jupiter`,
  );
  return {
    exitPrice: 0, // In production: derived from swap execution
    txSignature: `sim_sell_${tokenAddress}_${Date.now()}`,
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

    // In production: sell tokens first to get the actual exit price
    const { exitPrice: simulatedExit, txSignature: closeTx } = await executeTokenSell(
      position.token.address,
      tokensBought,
    );

    // Use simulated exit or calculate based on reason
    // In production this comes from the actual swap
    let exitPrice: number;
    if (simulatedExit > 0) {
      exitPrice = simulatedExit;
    } else {
      // Fallback: use entry price (P&L = 0) — in production would never happen
      exitPrice = entryPrice;
      console.warn(`${PREFIX} Using entry price as fallback exit price for position #${positionId}`);
    }

    // Calculate P&L
    const pnl = calculatePnL(
      entryPrice,
      exitPrice,
      tokensBought,
      userCapitalLamports,
      protocolCapitalLamports,
      tier,
    );

    // Calculate full distribution (revenue split from flat fees)
    const distribution = calculateFullDistribution(
      pnl,
      userCapitalLamports,
      protocolCapitalLamports,
    );

    // Determine final status
    const finalStatus = determineStatus(pnl.isProfitable, reason);

    // Persist everything in a transaction
    const positionSize = userCapitalLamports + protocolCapitalLamports;

    await prisma.$transaction([
      // Update position record with all calculated fields
      prisma.position.update({
        where: { id: positionId },
        data: {
          status: finalStatus,
          exitPrice: exitPrice,
          pnlSol: pnl.totalProfitLamports,
          userProfit: pnl.userGrossProfitLamports + pnl.userLockLamports,
          protocolRevenue: pnl.totalProtocolRevenueLamports,
          creatorPayout: distribution.revenue.creatorPayoutLamports,
          burnAmount: distribution.revenue.burnAmountLamports,
          poolReturn: distribution.revenue.poolReturnLamports,
          lockAmount: pnl.userLockLamports,
          closedAt: new Date(),
          closeTx,
        },
      }),

      // Pool ledger: return protocol capital
      prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: distribution.capitalReturn.protocolCapitalLamports,
          referenceId: positionId,
          txSignature: closeTx,
        },
      }),

      // Pool ledger: flat fee revenue recycled back to pool (50% of fee)
      ...(distribution.revenue.poolReturnLamports > 0n
        ? [
            prisma.poolLedger.create({
              data: {
                type: 'profit_recycle',
                amount: distribution.revenue.poolReturnLamports,
                referenceId: positionId,
                txSignature: closeTx,
              },
            }),
          ]
        : []),

      // Update token's total trading volume
      prisma.token.update({
        where: { id: position.token.id },
        data: {
          totalTradingVolume: position.token.totalTradingVolume + positionSize,
        },
      }),
    ]);

    // Dispatch downstream jobs

    // Burn job — buy back & burn $FRONT with 20% of flat fee revenue
    if (distribution.revenue.burnAmountLamports > 0n) {
      await burnQueue.add(
        'burn-from-position',
        {
          positionId,
          solAmountLamports: distribution.revenue.burnAmountLamports.toString(),
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    }

    // Lock job — 30% of profit → buy $FRONT & lock 7 days for user
    if (pnl.isProfitable && pnl.userLockLamports > 0n) {
      await lockQueue.add(
        'lock-from-position',
        {
          userWallet: position.userWallet,
          solAmountLamports: pnl.userLockLamports.toString(),
          positionId,
        },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
        },
      );
    }

    // Creator payout job — 30% of flat fee revenue to token creator
    if (distribution.revenue.creatorPayoutLamports > 0n) {
      await creatorPayoutsQueue.add(
        'payout-from-position',
        {
          tokenId: position.token.id,
          creatorWallet: position.token.creatorWallet,
          amountLamports: distribution.revenue.creatorPayoutLamports.toString(),
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
        `P&L: ${formatSol(pnl.totalProfitLamports)} SOL | ` +
        `Revenue: ${formatSol(pnl.totalProtocolRevenueLamports)} SOL | ` +
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

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSol(lamports: bigint): string {
  return (Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4);
}
