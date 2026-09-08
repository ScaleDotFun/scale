// ──────────────────────────────────────────────
// LOADED PROTOCOL — Lock Engine Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Handles $LOADED profit locks: buys $LOADED with 30% of trading profit,
// locks it for 7 days (protocol wallet is the escrow, DB enforces the
// hold), and processes unlock checks hourly. No simulation mode — if
// the $LOADED token isn't configured, jobs fail loudly and stay visible
// in the queue instead of writing fake records.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { PROFIT_LOCK_DURATION_MS, WEI_PER_ETH } from '@loaded/core';
import {
  getProtocolAccount,
  hasProtocolKey,
  swapNativeForToken,
  erc20Balance,
  erc20Transfer,
} from '@loaded/evm';
const fmtSol = (wei: bigint): string => (Number(wei) / Number(WEI_PER_ETH)).toFixed(4);
import { redisConnection, QUEUE_NAMES, lockQueue } from './queues.js';

const PREFIX = '[lock-engine]';

/** $LOADED token mint (SPL on Robinhood Chain) */
const LOADED_TOKEN_MINT = (process.env.LOADED_TOKEN_MINT ?? '').trim();

function assertLockConfigured(): void {
  if (LOADED_TOKEN_MINT.length < 32 || LOADED_TOKEN_MINT.length > 44) {
    throw new Error(`${PREFIX} LOADED_TOKEN_MINT is not a Robinhood Chain (hex) token mint — cannot execute $LOADED locks`);
  }
  if (!hasProtocolKey()) {
    throw new Error(`${PREFIX} Robinhood Chain protocol pool key not configured — cannot execute $LOADED locks`);
  }
}

interface LockJobData {
  userWallet: string;
  ethAmountWei: string; // bigint serialized as string
  positionId: number;
}

interface UnlockCheckJobData {
  /** Marker to differentiate from lock jobs */
  type: 'check-unlocks';
}

type LockEngineJobData = LockJobData | UnlockCheckJobData;

/**
 * Buy $LOADED with ETH via LI.FI for the lock.
 *
 * @returns Transaction signature and number of $LOADED tokens purchased
 */
async function executeFrontBuy(ethAmountWei: bigint): Promise<{
  buyTx: string;
  tokensPurchased: bigint;
}> {
  assertLockConfigured();
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} Buying $LOADED (${LOADED_TOKEN_MINT.substring(0, 10)}…) with ${fmtSol(ethAmountWei)} ETH via LI.FI`,
  );

  // amountOutMinimum comes from the LI.FI quote inside swapNativeForToken
  const { txHash, amountOut: tokensReceived } = await swapNativeForToken(
    protocolAccount,
    LOADED_TOKEN_MINT,
    ethAmountWei,
    300, // 3% slippage (bps)
  );

  console.log(
    `${PREFIX} Buy complete: received ${tokensReceived} $LOADED (tx: ${txHash})`,
  );

  return {
    buyTx: txHash,
    tokensPurchased: tokensReceived,
  };
}

/**
 * Lock the purchased $LOADED tokens by retaining them in the protocol wallet.
 *
 * The swap already deposits $LOADED into the protocol wallet, so "locking"
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
  const balance = await erc20Balance(LOADED_TOKEN_MINT, protocolAccount.address);

  if (balance < tokenAmount) {
    throw new Error(
      `${PREFIX} Protocol wallet $LOADED balance (${balance}) is less than lock amount (${tokenAmount}). ` +
      `Swap may have failed silently.`,
    );
  }

  console.log(
    `${PREFIX} 🔒 Verified ${tokenAmount} $LOADED held in protocol wallet escrow for ${userWallet}`,
  );

  // No separate on-chain tx needed — the protocol wallet holds the tokens
  // and the DB record prevents early release. Return a deterministic ID.
  return `lock_verified_${userWallet}_${Date.now()}`;
}

/**
 * Release unlocked $LOADED tokens to the user's custodial wallet via a
 * standard SPL transfer from the protocol wallet (escrow).
 *
 * @returns Transfer transaction signature
 */
async function executeUnlock(
  userWallet: string,
  tokenAmount: bigint,
): Promise<string> {
  assertLockConfigured();
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} 🔓 Transferring ${tokenAmount} $LOADED to ${userWallet}`,
  );

  const txHash = await erc20Transfer(
    protocolAccount,
    LOADED_TOKEN_MINT,
    userWallet,
    tokenAmount,
  );

  console.log(
    `${PREFIX} 🔓 Unlock complete: ${tokenAmount} $LOADED → ${userWallet} (tx: ${txHash})`,
  );

  return txHash;
}

/**
 * Process a lock job: buy $LOADED and lock it for 7 days.
 */
async function processLockJob(job: Job<LockJobData>): Promise<void> {
  const { userWallet, ethAmountWei: ethAmountStr, positionId } = job.data;
  const ethAmount = BigInt(ethAmountStr);

  console.log(
    `${PREFIX} Processing lock: ${fmtSol(ethAmount)} ETH → $LOADED for wallet ${userWallet} (position #${positionId})`,
  );

  try {
    // Step 1: Buy $LOADED with the ETH amount
    const { buyTx, tokensPurchased } = await executeFrontBuy(ethAmount);

    // Step 2: Lock the tokens
    const lockTx = await executeLock(userWallet, tokensPurchased);

    // Step 3: Record in database
    const unlocksAt = new Date(Date.now() + PROFIT_LOCK_DURATION_MS);

    await prisma.profitLock.create({
      data: {
        userWallet,
        ethAmount: ethAmount,
        tokenAmount: tokensPurchased,
        positionId,
        buyTx,
        lockTx,
        unlocksAt,
        isUnlocked: false,
      },
    });

    console.log(
      `${PREFIX} 🔒 Locked ${tokensPurchased} $LOADED for ${userWallet} until ${unlocksAt.toISOString()} (buy: ${buyTx}, lock: ${lockTx})`,
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
          `${PREFIX} 🔓 Unlocked ${lock.tokenAmount} $LOADED for ${lock.userWallet} (lock #${lock.id}, tx: ${unlockTx})`,
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


