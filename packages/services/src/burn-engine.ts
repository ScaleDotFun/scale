// ──────────────────────────────────────────────
// SCALE PROTOCOL — Burn Engine Worker (Solana)
// ──────────────────────────────────────────────
//
// Accumulates SOL for $SCALE buyback-and-burn operations.
// Once the pending balance exceeds the threshold, buys $SCALE via
// Jupiter and burns the tokens with the SPL burn instruction.
// Pending balance is persisted in Redis to survive process restarts.
// Until the $SCALE mint + Solana pool key are configured, burns defer
// honestly: the balance keeps accumulating and nothing is fabricated.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import {
  getProtocolAccount,
  hasProtocolKey,
  swapSolForToken,
  splBurn,
} from '@scale/solana';
const fmtSol = (lamports: bigint): string => (Number(lamports) / 1e9).toFixed(4);
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[burn-engine]';

/** Minimum SOL to accumulate before executing a burn (0.5 SOL) */
const BURN_THRESHOLD_LAMPORTS = BigInt(process.env.BURN_THRESHOLD_LAMPORTS ?? '500000000');

/** Redis key for the persistent burn accumulator (lamports) */
const REDIS_PENDING_BURN_KEY = 'scale:burn:pending_lamports';

/** $SCALE token mint (SPL on Solana) — read from env */
const SCALE_TOKEN_MINT = (process.env.SCALE_TOKEN_MINT ?? '').trim();

const canBurn = () => SCALE_TOKEN_MINT.length >= 32 && SCALE_TOKEN_MINT.length <= 44 && hasProtocolKey();

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
  const newVal = await redisConnection.call('INCRBY', REDIS_PENDING_BURN_KEY, amount.toString());
  return BigInt(newVal as string | number);
}

/**
 * Reset the pending burn balance in Redis (after executing a burn).
 */
async function resetPendingInRedis(): Promise<void> {
  await redisConnection.set(REDIS_PENDING_BURN_KEY, '0');
}

/**
 * Execute a buyback-and-burn: swap SOL → $SCALE via Jupiter,
 * then burn the tokens with the SPL burn instruction.
 *
 * @returns Transaction signature of the burn and tokens burned
 */
async function executeBurn(solAmountLamports: bigint): Promise<{
  txSignature: string;
  tokensBurned: bigint;
}> {
  const protocolAccount = getProtocolAccount();

  // Step 1: Jupiter swap SOL → $SCALE
  console.log(
    `${PREFIX} Swapping ${fmtSol(solAmountLamports)} SOL → $SCALE (${SCALE_TOKEN_MINT.substring(0, 10)}…)`,
  );

  // amountOutMinimum comes from the Jupiter quote inside swapSolForToken
  const { txHash: swapTx, amountOut: tokensReceived } = await swapSolForToken(
    protocolAccount,
    SCALE_TOKEN_MINT,
    solAmountLamports,
    300, // 3% slippage (bps)
  );

  console.log(
    `${PREFIX} Swap complete: received ${tokensReceived} $SCALE (tx: ${swapTx})`,
  );

  // Step 2: Burn — SPL burn instruction (supply actually decreases)
  console.log(`${PREFIX} Burning ${tokensReceived} $SCALE…`);

  const burnTx = await splBurn(protocolAccount, SCALE_TOKEN_MINT, tokensReceived);

  console.log(`${PREFIX} 🔥 Burn tx confirmed: ${burnTx}`);

  return {
    txSignature: burnTx,
    tokensBurned: tokensReceived,
  };
}

/**
 * Process a burn job: accumulate SOL in Redis, execute when threshold is met.
 */
async function processBurnJob(job: Job<BurnJobData>): Promise<void> {
  const { positionId, solAmountLamports: solAmountStr } = job.data;
  const solAmount = BigInt(solAmountStr);

  console.log(
    `${PREFIX} Received burn request: ${fmtSol(solAmount)} SOL from position #${positionId}`,
  );

  try {
    // Atomically accumulate in Redis
    const newPending = await addPendingToRedis(solAmount);
    console.log(`${PREFIX} Pending burn total: ${fmtSol(newPending)} SOL`);

    // Check if we've hit the threshold
    if (newPending < BURN_THRESHOLD_LAMPORTS) {
      console.log(
        `${PREFIX} Below threshold (${fmtSol(BURN_THRESHOLD_LAMPORTS)} SOL), accumulating...`,
      );
      return;
    }

    // Honest gate: without a $SCALE mint + Solana pool key there is
    // nothing real to burn — keep accumulating, fabricate nothing.
    if (!canBurn()) {
      console.warn(
        `${PREFIX} Burn deferred — $SCALE mint or Solana pool key not configured yet (pending: ${fmtSol(newPending)} SOL)`,
      );
      return;
    }

    // Execute burn with accumulated amount
    const burnAmount = newPending;

    console.log(`${PREFIX} Threshold reached! Executing burn of ${fmtSol(burnAmount)} SOL`);

    const { txSignature, tokensBurned } = await executeBurn(burnAmount);

    // Only reset Redis AFTER successful burn — if burn fails, amount stays for next attempt
    await resetPendingInRedis();

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
      `${PREFIX} 🔥 Burned ${fmtSol(burnAmount)} SOL → ${tokensBurned} $SCALE tokens (tx: ${txSignature})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${PREFIX} Error processing burn for position #${positionId}: ${msg}`,
    );
    throw err; // Let BullMQ retry — Redis still holds the accumulated amount
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


