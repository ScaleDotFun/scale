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
import { canSpendFromPool } from './pool-guard.js';

const PREFIX = '[lock-engine]';

/** $LOADED token mint (SPL on Robinhood Chain) */
const LOADED_TOKEN_MINT = (process.env.LOADED_TOKEN_MINT ?? '').trim();

/** Non-throwing form, for deciding whether to defer rather than fail. */
function isLockConfigured(): boolean {
  return (
    LOADED_TOKEN_MINT.length >= 32 &&
    LOADED_TOKEN_MINT.length <= 44 &&
    hasProtocolKey()
  );
}

/**
 * Marker on ProfitLock.buyTx for a lock we owe but have not bought yet.
 * The ETH is already withheld from the user's payout, so the debt must be on
 * the books even when the buy cannot run.
 */
const DEFERRED_BUY = 'deferred';

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

  // The user has ALREADY been paid out net of this amount: the close hands
  // back 70% of profit and keeps 30% on the promise of a $LOADED lock. If the
  // buy cannot run, that promise must still be recorded — otherwise the ETH
  // simply becomes pool funds with no row, no ledger entry and no way for the
  // user (or us) to know it is owed. Record the debt and return cleanly.
  if (!isLockConfigured()) {
    await recordDeferredLock(userWallet, ethAmount, positionId,
      '$LOADED is not configured yet');
    return;
  }

  // Same reserve the open route enforces. The user has already been paid their
  // 70%; the 30% is a debt we owe them either way, so record it and buy on the
  // next sweep rather than spending ETH an open position needs to be unwound.
  // This has to come BEFORE the claim below — taking the claim without buying
  // would mark the buy as done and it would never happen.
  const spendable = await canSpendFromPool(ethAmount);
  if (!spendable.ok) {
    await recordDeferredLock(userWallet, ethAmount, positionId,
      `pool is at its unwind reserve (${spendable.reason})`);
    return;
  }

  // Claim the buy exactly once per position, BEFORE spending anything.
  // executeFrontBuy moves real pool ETH, and this job runs with attempts: 3 —
  // so without a claim a transient failure after a confirmed swap re-bought
  // the same user's withheld profit on every retry, and completeDeferredLocks
  // would keep re-buying hourly on top of that. The ETH is gone the moment the
  // swap confirms; only a claim taken first can bound it.
  if (!(await claimLockBuy(positionId))) {
    console.warn(`${PREFIX} position #${positionId} lock buy already claimed — not buying again`);
    return;
  }

  try {
    // Step 1: Buy $LOADED with the ETH amount
    const { buyTx, tokensPurchased } = await executeFrontBuy(ethAmount);

    // Step 2: Lock the tokens
    const lockTx = await executeLock(userWallet, tokensPurchased);

    // Step 3: Record in database
    const unlocksAt = new Date(Date.now() + PROFIT_LOCK_DURATION_MS);

    await prisma.$transaction([
      prisma.profitLock.create({
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
      }),
      // The ETH really left the wallet to buy $LOADED. Without this debit the
      // ledger stays permanently above the wallet by every lock ever bought.
      prisma.poolLedger.create({
        data: { type: 'profit_lock_buy', amount: -ethAmount, referenceId: positionId, txHash: buyTx },
      }),
    ]);

    console.log(
      `${PREFIX} 🔒 Locked ${tokensPurchased} $LOADED for ${userWallet} until ${unlocksAt.toISOString()} (buy: ${buyTx}, lock: ${lockTx})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error processing lock for position #${positionId}: ${msg}`);
    // On the LAST attempt, book the debt instead of letting the job die
    // silently in the failed set. A retry is worth having; losing the user's
    // 30% with no record of it is not.
    // Never rethrow: the claim above is already spent, so a retry could not buy
    // again anyway, and letting the job die in the failed set would lose the
    // record of what the user is owed. Book the debt and finish.
    await recordDeferredLock(userWallet, ethAmount, positionId, msg);
  }
}

/**
 * Claim the right to spend pool ETH on this position's lock, exactly once.
 * Survives retries and process restarts; the key long outlives any backoff.
 */
async function claimLockBuy(positionId: number): Promise<boolean> {
  const res = await redisConnection.set(
    `loaded:lock:bought:${positionId}`, '1', 'EX', 90 * 24 * 3600, 'NX',
  );
  return res === 'OK';
}

/**
 * Book a lock we owe but could not buy. tokenAmount 0 + buyTx 'deferred' marks
 * it: the unlock sweep skips it, and `completeDeferredLocks` finishes the buy
 * once $LOADED is configured. Never throws — this is the safety net itself.
 */
async function recordDeferredLock(
  userWallet: string,
  ethAmount: bigint,
  positionId: number,
  why: string,
): Promise<void> {
  try {
    const existing = await prisma.profitLock.findFirst({ where: { positionId } });
    if (existing) return; // already booked (deferred or completed)
    await prisma.profitLock.create({
      data: {
        userWallet,
        ethAmount,
        tokenAmount: 0n,
        positionId,
        buyTx: DEFERRED_BUY,
        unlocksAt: new Date(Date.now() + PROFIT_LOCK_DURATION_MS),
        isUnlocked: false,
      },
    });
    console.warn(
      `${PREFIX} DEFERRED: ${fmtSol(ethAmount)} ETH of ${userWallet}'s locked profit (position ` +
      `#${positionId}) is owed but not yet bought — ${why}. Recorded as a liability against the pool.`,
    );
  } catch (e) {
    console.error(
      `${PREFIX} CRITICAL: could not record the deferred lock for position #${positionId} — ` +
      `${fmtSol(ethAmount)} ETH of ${userWallet}'s profit is withheld with NO database record: ` +
      `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Finish locks that were booked before $LOADED could be bought. Runs on the
 * hourly unlock sweep, so the backlog clears itself the moment the mint is set.
 */
async function completeDeferredLocks(): Promise<void> {
  if (!isLockConfigured()) return;
  const deferred = await prisma.profitLock.findMany({
    where: { buyTx: DEFERRED_BUY, isUnlocked: false },
    take: 25,
  });
  for (const lock of deferred) {
    // Same claim as the live path: this sweep runs hourly and would otherwise
    // re-buy a row that never manages to finish, forever.
    if (lock.positionId != null && !(await claimLockBuy(lock.positionId))) {
      console.warn(`${PREFIX} deferred lock #${lock.id} already claimed a buy — skipping`);
      continue;
    }
    try {
      const { buyTx, tokensPurchased } = await executeFrontBuy(lock.ethAmount);
      const lockTx = await executeLock(lock.userWallet, tokensPurchased);
      await prisma.$transaction([
        prisma.profitLock.update({
          where: { id: lock.id },
          data: { buyTx, lockTx, tokenAmount: tokensPurchased },
        }),
        prisma.poolLedger.create({
          data: { type: 'profit_lock_buy', amount: -lock.ethAmount, referenceId: lock.positionId, txHash: buyTx },
        }),
      ]);
      console.log(
        `${PREFIX} 🔒 Completed deferred lock #${lock.id}: ${fmtSol(lock.ethAmount)} ETH → ` +
        `${tokensPurchased} $LOADED for ${lock.userWallet}`,
      );
    } catch (e) {
      console.error(`${PREFIX} deferred lock #${lock.id} still cannot be bought: ${e instanceof Error ? e.message : e}`);
    }
  }
}

/**
 * Check for locks that are ready to be unlocked (unlocks_at <= now).
 */
async function processUnlockCheck(_job: Job<UnlockCheckJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Checking for expired locks...`);

  try {
    // Buy anything that was booked as owed but never purchased, first — the
    // backlog clears itself as soon as $LOADED is configured.
    await completeDeferredLocks().catch((e) =>
      console.error(`${PREFIX} deferred-lock sweep failed:`, e instanceof Error ? e.message : e),
    );

    const expiredLocks = await prisma.profitLock.findMany({
      where: {
        isUnlocked: false,
        unlocksAt: { lte: new Date() },
        // Deferred rows hold no tokens yet — releasing one would transfer 0.
        tokenAmount: { gt: 0n },
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
      // A row that can never succeed — e.g. a userWallet that predates the
      // chain move and is not a valid address — used to sit at the head of
      // this ordering forever, taking a batch slot on every sweep. Park it
      // after repeated failures so newer unlocks are never starved.
      const failKey = `loaded:lock:fails:${lock.id}`;
      const fails = Number((await redisConnection.get(failKey)) ?? 0);
      if (fails >= 5) {
        console.error(
          `${PREFIX} lock #${lock.id} (${lock.tokenAmount} $LOADED for ${lock.userWallet}) has failed ` +
          `${fails} times — skipping it so other unlocks proceed. NEEDS MANUAL RELEASE.`,
        );
        continue;
      }
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
        await redisConnection.call('INCRBY', failKey, '1');
        await redisConnection.call('EXPIRE', failKey, String(90 * 24 * 3600));
        console.error(`${PREFIX} Error unlocking lock #${lock.id} (failure ${fails + 1}/5): ${msg}`);
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


