// ──────────────────────────────────────────────
// FRONT PROTOCOL — Insurance Fund Worker
// ──────────────────────────────────────────────
//
// Manages the insurance fund that covers edge-case protocol losses.
// The fund builds up from a portion of flat fee revenue until it
// reaches the target (2% of pool size). If a position close results
// in a small protocol loss due to slippage, the insurance fund covers it.
//
// The protocol should NEVER lose money. This is the last line of defense.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import {
  LAMPORTS_PER_SOL,
  calculateInsuranceFundTarget,
  calculateInsuranceDeposit,
} from '@front-protocol/core';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[insurance-fund]';

interface InsuranceFundJobData {
  type: 'deposit' | 'withdrawal' | 'check';
  amountLamports?: string;
  reason?: string;
  positionId?: number;
  txSignature?: string;
}

/**
 * Get the current insurance fund balance.
 */
export async function getInsuranceFundBalance(): Promise<bigint> {
  const result = await prisma.insuranceFund.aggregate({
    _sum: {
      amount: true,
    },
  });

  // Deposits are positive, withdrawals are negative
  return result._sum.amount ?? 0n;
}

/**
 * Get the current pool balance for target calculation.
 */
async function getPoolBalance(): Promise<bigint> {
  const result = await prisma.poolLedger.aggregate({
    _sum: {
      amount: true,
    },
  });
  return result._sum.amount ?? 0n;
}

/**
 * Process an insurance fund job.
 */
async function processInsuranceFundJob(job: Job<InsuranceFundJobData>): Promise<void> {
  const { type, amountLamports, reason, positionId, txSignature } = job.data;

  try {
    switch (type) {
      case 'deposit': {
        const amount = BigInt(amountLamports || '0');
        if (amount <= 0n) {
          console.log(`${PREFIX} Skipping zero deposit`);
          return;
        }

        // Check if fund is at target
        const currentBalance = await getInsuranceFundBalance();
        const poolBalance = await getPoolBalance();
        const target = calculateInsuranceFundTarget(poolBalance);

        if (currentBalance >= target) {
          console.log(
            `${PREFIX} Fund at target (${formatSol(currentBalance)} / ${formatSol(target)} SOL), skipping deposit`,
          );
          return;
        }

        // Calculate actual deposit (may be less than requested if near target)
        const actualDeposit = calculateInsuranceDeposit(amount, currentBalance, target);

        if (actualDeposit <= 0n) {
          return;
        }

        await prisma.insuranceFund.create({
          data: {
            type: 'deposit',
            amount: actualDeposit,
            reason: reason || 'flat_fee_allocation',
            positionId,
            txSignature,
          },
        });

        console.log(
          `${PREFIX} Deposited ${formatSol(actualDeposit)} SOL | ` +
          `Balance: ${formatSol(currentBalance + actualDeposit)} / ${formatSol(target)} SOL`,
        );
        break;
      }

      case 'withdrawal': {
        const amount = BigInt(amountLamports || '0');
        if (amount <= 0n) return;

        const currentBalance = await getInsuranceFundBalance();
        if (amount > currentBalance) {
          console.error(
            `${PREFIX} ⚠️ Withdrawal exceeds balance! Requested: ${formatSol(amount)} SOL, Balance: ${formatSol(currentBalance)} SOL`,
          );
          // Still process but log the warning — this is a critical event
        }

        // Record as negative amount
        await prisma.insuranceFund.create({
          data: {
            type: 'withdrawal',
            amount: -amount,
            reason: reason || 'slippage_coverage',
            positionId,
            txSignature,
          },
        });

        console.log(
          `${PREFIX} ⚠️ Withdrew ${formatSol(amount)} SOL for: ${reason || 'unknown'} | ` +
          `Remaining: ${formatSol(currentBalance - amount)} SOL`,
        );
        break;
      }

      case 'check': {
        const currentBalance = await getInsuranceFundBalance();
        const poolBalance = await getPoolBalance();
        const target = calculateInsuranceFundTarget(poolBalance);
        const pct = poolBalance > 0n
          ? Number((currentBalance * 10000n) / poolBalance) / 100
          : 0;

        console.log(
          `${PREFIX} Fund status: ${formatSol(currentBalance)} / ${formatSol(target)} SOL (${pct.toFixed(2)}% of pool)`,
        );
        break;
      }

      default:
        console.error(`${PREFIX} Unknown job type: ${type}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error processing ${type}: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const insuranceFundWorker = new Worker<InsuranceFundJobData>(
  QUEUE_NAMES.INSURANCE_FUND,
  processInsuranceFundJob,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

insuranceFundWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed (${job.data.type})`);
});

insuranceFundWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

insuranceFundWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSol(lamports: bigint): string {
  return (Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4);
}
