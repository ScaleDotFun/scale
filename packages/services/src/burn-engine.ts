// ──────────────────────────────────────────────
// FRONT PROTOCOL — Burn Engine Worker
// ──────────────────────────────────────────────
//
// Accumulates SOL for $FRONT buyback-and-burn operations.
// Once the pending balance exceeds 1 SOL, executes the burn batch.
// Pending balance is persisted in Redis to survive process restarts.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL } from '@front-protocol/core';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[burn-engine]';

/** Minimum SOL to accumulate before executing a burn (1 SOL) */
const BURN_THRESHOLD_LAMPORTS = LAMPORTS_PER_SOL; // 1_000_000_000n

/** Redis key for the persistent burn accumulator */
const REDIS_PENDING_BURN_KEY = 'front:burn:pending_lamports';

/** $FRONT token mint — used as output mint for Jupiter swap */
const FRONT_TOKEN_MINT = process.env.FRONT_TOKEN_MINT ?? '';

interface BurnJobData {
  positionId: number;
  solAmountLamports: string; // bigint serialized as string
}

/**
 * Get the current pending burn balance from Redis.
 */
async function getPendingFromRedis(): Promise<bigint> {
  const val = await redisConnection.get(REDIS_PENDING_BURN_KEY);
  return val ? BigInt(val) : 0n;
}

/**
 * Atomically increment the pending burn balance in Redis.
 */
async function addPendingToRedis(amount: bigint): Promise<bigint> {
  const newVal = await redisConnection.incrby(REDIS_PENDING_BURN_KEY, Number(amount));
  return BigInt(newVal);
}

/**
 * Reset the pending burn balance in Redis (after executing a burn).
 */
async function resetPendingInRedis(): Promise<void> {
  await redisConnection.set(REDIS_PENDING_BURN_KEY, '0');
}

/**
 * Execute a buyback-and-burn: swap SOL → $FRONT via Jupiter, then burn the tokens.
 *
 * @returns Transaction signature and number of $FRONT tokens burned
 */
async function executeBurn(solAmountLamports: bigint): Promise<{
  txSignature: string;
  tokensBurned: bigint;
}> {
  if (!FRONT_TOKEN_MINT) {
    throw new Error(`${PREFIX} FRONT_TOKEN_MINT env var is not set — cannot execute burn swap`);
  }

  // SOLANA: Execute in 2 steps:
  //   1. Jupiter swap: SOL → $FRONT via api.jup.ag
  //      - GET /quote?inputMint=So11...&outputMint=${FRONT_TOKEN_MINT}&amount=${solAmount}
  //      - POST /swap with quoteResponse
  //   2. SPL Token burn instruction
  //      - Create burn instruction for the received $FRONT tokens
  //      - Sign and send transaction
  console.log(
    `${PREFIX} SOLANA: Executing Jupiter swap ${formatSol(solAmountLamports)} SOL → $FRONT (${FRONT_TOKEN_MINT.substring(0, 8)}…), then burn`,
  );

  // Simulated return — in production comes from the actual swap
  const estimatedTokens = solAmountLamports * 1000n; // fake rate for logging
  return {
    txSignature: `sim_burn_${Date.now()}`,
    tokensBurned: estimatedTokens,
  };
}

/**
 * Process a burn job: accumulate SOL in Redis, execute when threshold is met.
 */
async function processBurnJob(job: Job<BurnJobData>): Promise<void> {
  const { positionId, solAmountLamports: solAmountStr } = job.data;
  const solAmount = BigInt(solAmountStr);

  console.log(
    `${PREFIX} Received burn request: ${formatSol(solAmount)} SOL from position #${positionId}`,
  );

  try {
    // Atomically accumulate in Redis
    const newPending = await addPendingToRedis(solAmount);
    console.log(`${PREFIX} Pending burn total: ${formatSol(newPending)} SOL`);

    // Check if we've hit the threshold
    if (newPending < BURN_THRESHOLD_LAMPORTS) {
      console.log(
        `${PREFIX} Below threshold (${formatSol(BURN_THRESHOLD_LAMPORTS)} SOL), accumulating...`,
      );
      return;
    }

    // Execute burn with accumulated amount
    const burnAmount = newPending;
    await resetPendingInRedis(); // reset before async operation

    console.log(`${PREFIX} Threshold reached! Executing burn of ${formatSol(burnAmount)} SOL`);

    const { txSignature, tokensBurned } = await executeBurn(burnAmount);

    // Record burn in database
    await prisma.$transaction([
      // Create burn record
      prisma.burn.create({
        data: {
          solAmount: burnAmount,
          tokenAmount: tokensBurned,
          txSignature,
          positionId,
        },
      }),

      // Pool ledger entry (outflow — SOL leaves the pool for burn)
      prisma.poolLedger.create({
        data: {
          type: 'burn',
          amount: -burnAmount, // negative = outflow
          referenceId: positionId,
          txSignature,
        },
      }),
    ]);

    console.log(
      `${PREFIX} 🔥 Burned ${formatSol(burnAmount)} SOL → ${tokensBurned} $FRONT tokens (tx: ${txSignature})`,
    );
  } catch (err) {
    // On failure, put the amount back so it's not lost
    const solAmount2 = BigInt(solAmountStr);
    await addPendingToRedis(solAmount2);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${PREFIX} Error processing burn for position #${positionId}: ${msg} (${formatSol(solAmount2)} SOL returned to pending)`,
    );
    throw err; // Let BullMQ retry
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const burnEngineWorker = new Worker<BurnJobData>(
  QUEUE_NAMES.BURN_QUEUE,
  processBurnJob,
  {
    connection: redisConnection,
    concurrency: 1, // sequential to maintain accurate pending balance
  },
);

burnEngineWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

burnEngineWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

burnEngineWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Accessors (for testing / monitoring)
// ──────────────────────────────────────────────

/** Get the current pending burn amount from Redis (for monitoring) */
export async function getPendingBurnLamports(): Promise<bigint> {
  return getPendingFromRedis();
}

/** Reset pending burns in Redis (for testing) */
export async function resetPendingBurns(): Promise<void> {
  await resetPendingInRedis();
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatSol(lamports: bigint): string {
  return (Number(lamports) / Number(LAMPORTS_PER_SOL)).toFixed(4);
}
