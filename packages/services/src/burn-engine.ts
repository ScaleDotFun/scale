// ──────────────────────────────────────────────
// SCALE PROTOCOL — Burn Engine Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Accumulates ETH for $SCALE buyback-and-burn operations.
// Once the pending balance exceeds the threshold, buys $SCALE via
// Uniswap V3 and sends it to the dead address (0x…dEaD).
// Pending balance is persisted in Redis to survive process restarts.
// Until the $SCALE token + EVM pool key are configured, burns defer
// honestly: the balance keeps accumulating and nothing is fabricated.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import {
  getProtocolAccount,
  hasEvmProtocolKey,
  swapEthForToken,
  erc20Transfer,
  DEAD_ADDRESS,
} from '@scale/evm';
import { getTokenPricesEth } from './evm-prices.js';

const fmtEth = (wei: bigint): string => (Number(wei) / 1e18).toFixed(6);
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[burn-engine]';

/** Minimum ETH to accumulate before executing a burn (0.05 ETH) */
const BURN_THRESHOLD_LAMPORTS = BigInt(process.env.BURN_THRESHOLD_WEI ?? '50000000000000000');

/** Redis key for the persistent burn accumulator (wei) */
const REDIS_PENDING_BURN_KEY = 'scale:burn:pending_wei';

/** $SCALE token address (ERC-20 on Robinhood Chain) — read from env */
const FRONT_TOKEN_MINT = (process.env.FRONT_TOKEN_MINT ?? '').trim();

const canBurn = () => /^0x[a-fA-F0-9]{40}$/.test(FRONT_TOKEN_MINT) && hasEvmProtocolKey();

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
 * Execute a buyback-and-burn: swap ETH → $SCALE via Uniswap V3,
 * then transfer the tokens to the dead address.
 *
 * @returns Transaction hash of the burn transfer and tokens burned
 */
async function executeBurn(solAmountLamports: bigint): Promise<{
  txSignature: string;
  tokensBurned: bigint;
}> {
  const protocolAccount = getProtocolAccount();

  // Step 1: Uniswap V3 swap ETH → $SCALE
  console.log(
    `${PREFIX} Swapping ${fmtEth(solAmountLamports)} ETH → $SCALE (${FRONT_TOKEN_MINT.substring(0, 10)}…)`,
  );

  let minOut = 1n;
  try {
    const prices = await getTokenPricesEth([FRONT_TOKEN_MINT]);
    const p = prices.get(FRONT_TOKEN_MINT.toLowerCase());
    if (p && p.weiPerRawUnit > 0) {
      const expected = BigInt(Math.floor(Number(solAmountLamports) / p.weiPerRawUnit));
      const floor = (expected * 9_600n) / 10_000n; // 3% slippage + 1% pool fee
      if (floor > 0n) minOut = floor;
    }
  } catch {
    // price feed down — pool state is the fallback defense
  }

  const { txHash: swapTx, amountOut: tokensReceived } = await swapEthForToken(
    protocolAccount,
    FRONT_TOKEN_MINT,
    solAmountLamports,
    minOut,
  );

  console.log(
    `${PREFIX} Swap complete: received ${tokensReceived} $SCALE (tx: ${swapTx})`,
  );

  // Step 2: Burn — transfer to the dead address (irrecoverable)
  console.log(`${PREFIX} Burning ${tokensReceived} $SCALE → ${DEAD_ADDRESS}…`);

  const burnTx = await erc20Transfer(protocolAccount, FRONT_TOKEN_MINT, DEAD_ADDRESS, tokensReceived);

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
    `${PREFIX} Received burn request: ${fmtEth(solAmount)} ETH from position #${positionId}`,
  );

  try {
    // Atomically accumulate in Redis
    const newPending = await addPendingToRedis(solAmount);
    console.log(`${PREFIX} Pending burn total: ${fmtEth(newPending)} ETH`);

    // Check if we've hit the threshold
    if (newPending < BURN_THRESHOLD_LAMPORTS) {
      console.log(
        `${PREFIX} Below threshold (${fmtEth(BURN_THRESHOLD_LAMPORTS)} ETH), accumulating...`,
      );
      return;
    }

    // Honest gate: without a $SCALE token + EVM pool key there is
    // nothing real to burn — keep accumulating, fabricate nothing.
    if (!canBurn()) {
      console.warn(
        `${PREFIX} Burn deferred — $SCALE token or EVM pool key not configured yet (pending: ${fmtEth(newPending)} ETH)`,
      );
      return;
    }

    // Execute burn with accumulated amount
    const burnAmount = newPending;

    console.log(`${PREFIX} Threshold reached! Executing burn of ${fmtEth(burnAmount)} ETH`);

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
      `${PREFIX} 🔥 Burned ${fmtEth(burnAmount)} ETH → ${tokensBurned} $SCALE tokens (tx: ${txSignature})`,
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


