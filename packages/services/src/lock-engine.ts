// ──────────────────────────────────────────────
// SCALE PROTOCOL — Lock Engine Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Handles $SCALE profit locks: buys $SCALE with 30% of trading profit,
// locks it for 7 days (protocol wallet is the escrow, DB enforces the
// hold), and processes unlock checks hourly. No simulation mode — if
// the $SCALE token isn't configured, jobs fail loudly and stay visible
// in the queue instead of writing fake records.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import { PROFIT_LOCK_DURATION_MS } from '@scale/core';
import {
  getProtocolAccount,
  hasEvmProtocolKey,
  swapEthForToken,
  erc20Balance,
  erc20Transfer,
} from '@scale/evm';
import { getTokenPricesEth } from './evm-prices.js';

const fmtEth = (wei: bigint): string => (Number(wei) / 1e18).toFixed(6);
import { redisConnection, QUEUE_NAMES, lockQueue } from './queues.js';

const PREFIX = '[lock-engine]';

/** $SCALE token address (ERC-20 on Robinhood Chain) */
const FRONT_TOKEN_MINT = (process.env.FRONT_TOKEN_MINT ?? '').trim();

function assertLockConfigured(): void {
  if (!/^0x[a-fA-F0-9]{40}$/.test(FRONT_TOKEN_MINT)) {
    throw new Error(`${PREFIX} FRONT_TOKEN_MINT is not a Robinhood Chain (0x…) token address — cannot execute $SCALE locks`);
  }
  if (!hasEvmProtocolKey()) {
    throw new Error(`${PREFIX} EVM protocol pool key not configured — cannot execute $SCALE locks`);
  }
}

interface LockJobData {
  userWallet: string;
  solAmountLamports: string; // bigint serialized as string
  positionId: number;
}

interface UnlockCheckJobData {
  /** Marker to differentiate from lock jobs */
  type: 'check-unlocks';
}

type LockEngineJobData = LockJobData | UnlockCheckJobData;

/**
 * Buy $SCALE with ETH via Uniswap V3 for the lock.
 *
 * @returns Transaction hash and number of $SCALE tokens purchased
 */
async function executeFrontBuy(solAmountLamports: bigint): Promise<{
  buyTx: string;
  tokensPurchased: bigint;
}> {
  assertLockConfigured();
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} Buying $SCALE (${FRONT_TOKEN_MINT.substring(0, 10)}…) with ${fmtEth(solAmountLamports)} ETH via Uniswap V3`,
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

  const { txHash, amountOut: tokensReceived } = await swapEthForToken(
    protocolAccount,
    FRONT_TOKEN_MINT,
    solAmountLamports,
    minOut,
  );

  console.log(
    `${PREFIX} Buy complete: received ${tokensReceived} $SCALE (tx: ${txHash})`,
  );

  return {
    buyTx: txHash,
    tokensPurchased: tokensReceived,
  };
}

/**
 * Lock the purchased $SCALE tokens by retaining them in the protocol wallet.
 *
 * The swap already deposits $SCALE into the protocol wallet, so "locking"
 * means verifying the tokens are there. The protocol wallet IS the escrow —
 * the DB record (with `unlocksAt`) enforces the 7-day hold.
 *
 * @returns Verification marker (no separate on-chain lock tx)
 */
async function executeLock(
  userWallet: string,
  tokenAmount: bigint,
): Promise<string> {
  assertLockConfigured();

  // Verify protocol wallet actually holds the tokens
  const protocolAccount = getProtocolAccount();
  const balance = await erc20Balance(FRONT_TOKEN_MINT, protocolAccount.address);

  if (balance < tokenAmount) {
    throw new Error(
      `${PREFIX} Protocol wallet $SCALE balance (${balance}) is less than lock amount (${tokenAmount}). ` +
      `Swap may have failed silently.`,
    );
  }

  console.log(
    `${PREFIX} 🔒 Verified ${tokenAmount} $SCALE held in protocol wallet escrow for ${userWallet}`,
  );

  // No separate on-chain tx needed — the protocol wallet holds the tokens
  // and the DB record prevents early release. Return a deterministic ID.
  return `lock_verified_${userWallet}_${Date.now()}`;
}

/**
 * Release unlocked $SCALE tokens to the user's custodial wallet via a
 * standard ERC-20 transfer from the protocol wallet (escrow).
 *
 * @returns Transfer transaction hash
 */
async function executeUnlock(
  userWallet: string,
  tokenAmount: bigint,
): Promise<string> {
  assertLockConfigured();
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} 🔓 Transferring ${tokenAmount} $SCALE to ${userWallet}`,
  );

  const txSignature = await erc20Transfer(
    protocolAccount,
    FRONT_TOKEN_MINT,
    userWallet,
    tokenAmount,
  );

  console.log(
    `${PREFIX} 🔓 Unlock complete: ${tokenAmount} $SCALE → ${userWallet} (tx: ${txSignature})`,
  );

  return txSignature;
}

/**
 * Process a lock job: buy $FRONT and lock it for 7 days.
 */
async function processLockJob(job: Job<LockJobData>): Promise<void> {
  const { userWallet, solAmountLamports: solAmountStr, positionId } = job.data;
  const solAmount = BigInt(solAmountStr);

  console.log(
    `${PREFIX} Processing lock: ${fmtEth(solAmount)} ETH → $SCALE for wallet ${userWallet} (position #${positionId})`,
  );

  try {
    // Step 1: Buy $SCALE with the ETH amount
    const { buyTx, tokensPurchased } = await executeFrontBuy(solAmount);

    // Step 2: Lock the tokens
    const lockTx = await executeLock(userWallet, tokensPurchased);

    // Step 3: Record in database
    const unlocksAt = new Date(Date.now() + PROFIT_LOCK_DURATION_MS);

    await prisma.profitLock.create({
      data: {
        userWallet,
        solAmount: solAmount,
        tokenAmount: tokensPurchased,
        positionId,
        buyTx,
        lockTx,
        unlocksAt,
        isUnlocked: false,
      },
    });

    console.log(
      `${PREFIX} 🔒 Locked ${tokensPurchased} $SCALE for ${userWallet} until ${unlocksAt.toISOString()} (buy: ${buyTx}, lock: ${lockTx})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error processing lock for position #${positionId}: ${msg}`);
    throw err;
  }
}

/**
 * Check for locks that are ready to be unlocked (unlocks_at <= now).
 */
async function processUnlockCheck(_job: Job<UnlockCheckJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Checking for expired locks...`);

  try {
    const expiredLocks = await prisma.profitLock.findMany({
      where: {
        isUnlocked: false,
        unlocksAt: { lte: new Date() },
      },
      orderBy: { unlocksAt: 'asc' },
      take: 100, // process in batches
    });

    if (expiredLocks.length === 0) {
      console.log(`${PREFIX} No expired locks found`);
      return;
    }

    console.log(`${PREFIX} Found ${expiredLocks.length} expired lock(s) to unlock`);

    let unlockedCount = 0;

    for (const lock of expiredLocks) {
      try {
        // Execute on-chain unlock
        const unlockTx = await executeUnlock(lock.userWallet, lock.tokenAmount);

        // Update database
        await prisma.profitLock.update({
          where: { id: lock.id },
          data: {
            isUnlocked: true,
            unlockTx,
          },
        });

        unlockedCount++;
        console.log(
          `${PREFIX} 🔓 Unlocked ${lock.tokenAmount} $SCALE for ${lock.userWallet} (lock #${lock.id}, tx: ${unlockTx})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error unlocking lock #${lock.id}: ${msg}`);
        // Continue to next lock
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Unlock check complete: ${unlockedCount}/${expiredLocks.length} unlocked (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error in unlock check: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker — routes jobs based on name
// ──────────────────────────────────────────────

export const lockEngineWorker = new Worker<LockEngineJobData>(
  QUEUE_NAMES.LOCK_QUEUE,
  async (job: Job<LockEngineJobData>) => {
    if (job.name === 'check-unlocks') {
      return processUnlockCheck(job as Job<UnlockCheckJobData>);
    }
    return processLockJob(job as Job<LockJobData>);
  },
  {
    connection: redisConnection,
    concurrency: 3,
  },
);

lockEngineWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} (${job.name}) completed`);
});

lockEngineWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} (${job?.name}) failed: ${err.message}`);
});

lockEngineWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

/**
 * Schedule the hourly unlock check as a repeatable job.
 */
export async function scheduleLockUnlockChecker(): Promise<void> {
  // Remove any existing repeatable unlock-check jobs
  const existing = await lockQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'check-unlocks') {
      await lockQueue.removeRepeatableByKey(job.key);
    }
  }

  await lockQueue.add(
    'check-unlocks',
    { type: 'check-unlocks' as const },
    {
      repeat: { every: 60 * 60 * 1000 }, // every hour
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );

  console.log(`${PREFIX} Scheduled unlock checks every hour`);
}


