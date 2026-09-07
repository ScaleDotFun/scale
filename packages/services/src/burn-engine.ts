// ──────────────────────────────────────────────
// LOADED PROTOCOL — Burn Engine Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Accumulates ETH for $LOADED buyback-and-burn operations.
// Once the pending balance exceeds the threshold, buys $LOADED via
// LI.FI and burns the tokens with the SPL burn instruction.
// Pending balance is persisted in Redis to survive process restarts.
// Until the $LOADED mint + Robinhood Chain pool key are configured, burns defer
// honestly: the balance keeps accumulating and nothing is fabricated.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH } from '@loaded/core';
import {
  getProtocolAccount,
  hasProtocolKey,
  swapNativeForToken,
  erc20Burn,
} from '@loaded/evm';
const fmtSol = (wei: bigint): string => (Number(wei) / Number(WEI_PER_ETH)).toFixed(4);
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[burn-engine]';

/** Minimum ETH to accumulate before executing a burn (0.05 ETH) */
const BURN_THRESHOLD_WEI = BigInt(
  process.env.BURN_THRESHOLD_WEI ?? (WEI_PER_ETH / 20n).toString(),
);

/** Redis key for the persistent burn accumulator (wei) */
const REDIS_PENDING_BURN_KEY = 'loaded:burn:pending_wei';

/** $LOADED token mint (SPL on Robinhood Chain) — read from env */
const LOADED_TOKEN_MINT = (process.env.LOADED_TOKEN_MINT ?? '').trim();

const canBurn = () => LOADED_TOKEN_MINT.length >= 32 && LOADED_TOKEN_MINT.length <= 44 && hasProtocolKey();

interface BurnJobData {
  positionId: number;
  ethAmountWei: string; // bigint serialized as string
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
 * Execute a buyback-and-burn: swap ETH → $LOADED via LI.FI,
 * then burn the tokens with the SPL burn instruction.
 *
 * @returns Transaction signature of the burn and tokens burned
 */
async function executeBurn(ethAmountWei: bigint): Promise<{
  txHash: string;
  tokensBurned: bigint;
}> {
  const protocolAccount = getProtocolAccount();

  // Step 1: LI.FI swap ETH → $LOADED
  console.log(
    `${PREFIX} Swapping ${fmtSol(ethAmountWei)} ETH → $LOADED (${LOADED_TOKEN_MINT.substring(0, 10)}…)`,
  );

  // amountOutMinimum comes from the LI.FI quote inside swapNativeForToken
  const { txHash: swapTx, amountOut: tokensReceived } = await swapNativeForToken(
    protocolAccount,
    LOADED_TOKEN_MINT,
    ethAmountWei,
    300, // 3% slippage (bps)
  );

  console.log(
    `${PREFIX} Swap complete: received ${tokensReceived} $LOADED (tx: ${swapTx})`,
  );

  // Step 2: Burn — SPL burn instruction (supply actually decreases)
  console.log(`${PREFIX} Burning ${tokensReceived} $LOADED…`);

  const burnTx = await erc20Burn(protocolAccount, LOADED_TOKEN_MINT, tokensReceived);

  console.log(`${PREFIX} 🔥 Burn tx confirmed: ${burnTx}`);

  return {
    txHash: burnTx,
    tokensBurned: tokensReceived,
  };
}

/**
 * Process a burn job: accumulate ETH in Redis, execute when threshold is met.
 */
async function processBurnJob(job: Job<BurnJobData>): Promise<void> {
  const { positionId, ethAmountWei: ethAmountStr } = job.data;
  const ethAmount = BigInt(ethAmountStr);

  console.log(
    `${PREFIX} Received burn request: ${fmtSol(ethAmount)} ETH from position #${positionId}`,
  );

  try {
    // Atomically accumulate in Redis
    const newPending = await addPendingToRedis(ethAmount);
    console.log(`${PREFIX} Pending burn total: ${fmtSol(newPending)} ETH`);

    // Check if we've hit the threshold
    if (newPending < BURN_THRESHOLD_WEI) {
      console.log(
        `${PREFIX} Below threshold (${fmtSol(BURN_THRESHOLD_WEI)} ETH), accumulating...`,
      );
      return;
    }

    // Honest gate: without a $LOADED mint + Robinhood Chain pool key there is
    // nothing real to burn — keep accumulating, fabricate nothing.
    if (!canBurn()) {
      console.warn(
        `${PREFIX} Burn deferred — $LOADED mint or Robinhood Chain pool key not configured yet (pending: ${fmtSol(newPending)} ETH)`,
      );
      return;
    }

    // Execute burn with accumulated amount
    const burnAmount = newPending;

    console.log(`${PREFIX} Threshold reached! Executing burn of ${fmtSol(burnAmount)} ETH`);

    const { txHash, tokensBurned } = await executeBurn(burnAmount);

    // Only reset Redis AFTER successful burn — if burn fails, amount stays for next attempt
    await resetPendingInRedis();

    // Record burn in database
    await prisma.$transaction([
      // Create burn record
      prisma.burn.create({
        data: {
          ethAmount: burnAmount,
          tokenAmount: tokensBurned,
          txHash,
          positionId,
        },
      }),

      // Pool ledger entry (outflow — ETH leaves the pool for burn)
      prisma.poolLedger.create({
        data: {
          type: 'burn',
          amount: -burnAmount, // negative = outflow
          referenceId: positionId,
          txHash,
        },
      }),
    ]);

    console.log(
      `${PREFIX} 🔥 Burned ${fmtSol(burnAmount)} ETH → ${tokensBurned} $LOADED tokens (tx: ${txHash})`,
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
export async function getPendingBurnWei(): Promise<bigint> {
  return getPendingFromRedis();
}

/** Reset pending burns in Redis (for testing) */
export async function resetPendingBurns(): Promise<void> {
  await resetPendingInRedis();
}


