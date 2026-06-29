// ──────────────────────────────────────────────
// FRONT PROTOCOL — Fee Claimer Worker
// ──────────────────────────────────────────────
//
// Periodically claims redirect fees from Pump.fun for each listed token.
// Runs as a repeatable BullMQ job with randomized 30-60 min intervals.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL } from '@front-protocol/core';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

interface FeeClaimJobData {
  /** When omitted, processes all active tokens */
  tokenId?: number;
}

/**
 * Simulate checking claimable fees for a token.
 * In production this would query the Pump.fun fee wallet PDA on-chain.
 *
 * @returns Claimable amount in lamports, or 0 if nothing to claim
 */
async function checkClaimableFees(tokenAddress: string, feeWalletPda: string | null): Promise<bigint> {
  // SOLANA: would call getAccountInfo on the fee wallet PDA
  // and calculate the claimable balance based on rent-exempt minimum
  console.log(`${PREFIX} Checking claimable fees for ${tokenAddress} (PDA: ${feeWalletPda ?? 'none'})`);

  // Simulated: return a random small amount or 0 for demo
  // In production this reads on-chain balance
  return 0n;
}

/**
 * Execute the fee claim transaction for a token.
 *
 * @returns Transaction signature
 */
async function executeFeeClaim(tokenAddress: string, amountLamports: bigint): Promise<string> {
  // SOLANA: would execute the Pump.fun claim instruction:
  //   1. Build ClaimFees instruction for program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P
  //   2. Sign with protocol authority keypair
  //   3. Send and confirm transaction
  console.log(
    `${PREFIX} SOLANA: would execute fee claim for ${tokenAddress}, amount: ${amountLamports} lamports (${formatSol(amountLamports)} SOL)`,
  );
  return `sim_fee_claim_${tokenAddress}_${Date.now()}`;
}

/**
 * Process a single fee-claim job: iterate all active tokens and claim fees.
 */
async function processFeeClaimJob(job: Job<FeeClaimJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting fee claim run (job ${job.id})`);

  try {
    // Fetch tokens to process
    const whereClause = job.data.tokenId
      ? { id: job.data.tokenId, isActive: true }
      : { isActive: true };

    const tokens = await prisma.token.findMany({
      where: whereClause,
      select: {
        id: true,
        address: true,
        symbol: true,
        feeWalletPda: true,
        totalFeesClaimed: true,
      },
    });

    if (tokens.length === 0) {
      console.log(`${PREFIX} No active tokens to process`);
      return;
    }

    console.log(`${PREFIX} Processing ${tokens.length} active token(s)`);

    let totalClaimed = 0n;
    let claimsExecuted = 0;

    for (const token of tokens) {
      try {
        const claimable = await checkClaimableFees(token.address, token.feeWalletPda);

        if (claimable <= 0n) {
          continue;
        }

        // Execute the claim
        const txSignature = await executeFeeClaim(token.address, claimable);

        // Record in database within a transaction
        await prisma.$transaction([
          // Create fee claim record
          prisma.feeClaim.create({
            data: {
              tokenId: token.id,
              amount: claimable,
              txSignature,
            },
          }),

          // Update token's total fees claimed
          prisma.token.update({
            where: { id: token.id },
            data: {
              totalFeesClaimed: token.totalFeesClaimed + claimable,
            },
          }),

          // Add pool ledger entry (inflow)
          prisma.poolLedger.create({
            data: {
              type: 'fee_claim',
              amount: claimable,
              referenceId: token.id,
              txSignature,
            },
          }),
        ]);

        totalClaimed += claimable;
        claimsExecuted++;

        console.log(
          `${PREFIX} Claimed ${formatSol(claimable)} SOL from ${token.symbol ?? token.address} (tx: ${txSignature})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error claiming fees for token ${token.address}: ${msg}`);
        // Continue to next token — don't let one failure block others
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Fee claim run complete: ${claimsExecuted} claim(s), ${formatSol(totalClaimed)} SOL total (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Fatal error in fee claim job: ${msg}`);
    throw err; // Let BullMQ handle retry
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const feeClaimerWorker = new Worker<FeeClaimJobData>(
  QUEUE_NAMES.FEE_CLAIMS,
  processFeeClaimJob,
  {
    connection: redisConnection,
    concurrency: 1, // sequential claims to avoid nonce issues
    limiter: {
      max: 1,
      duration: 5000, // at most 1 job per 5s
    },
  },
);

feeClaimerWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

feeClaimerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

feeClaimerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

/**
 * Schedule the fee claimer to run every 30-60 minutes.
 * Uses a randomized interval to avoid predictable patterns.
 */
export async function scheduleFeeClaimer(): Promise<void> {
  // Remove any existing repeatable jobs first
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  // Randomize between 30-60 minutes (in ms)
  const intervalMs = (30 + Math.floor(Math.random() * 31)) * 60 * 1000;

  await feeClaimsQueue.add(
    'claim-all-fees',
    {},
    {
      repeat: { every: intervalMs },
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30_000, // start at 30s, then 60s, 120s
      },
    },
  );

  console.log(`${PREFIX} Scheduled fee claims every ${Math.round(intervalMs / 60_000)} minutes`);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSol(lamports: bigint): string {
  return (Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4);
}
