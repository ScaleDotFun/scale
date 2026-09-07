// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee Claimer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// On PONS, creator fees accrue on-chain to the wallet that launched
// the coin. For the protocol's own $LOADED launch those fees are claimable
// by the pool wallet via PONS's claim flow (currently manual — PONS
// publishes no third-party claim API). LOADED's core revenue (flat fees on
// positions) needs no claiming at all: it arrives inline at position close
// and is recorded straight into the pool ledger.
//
// What this worker DOES do — honestly — is watch a dedicated fee wallet
// (FEE_WALLET env; the pool wallet's ETH balance is too noisy since user
// collateral flows through it constantly) and record real ETH inflows as
// fee_claim ledger rows, so manually-claimed PONS creator fees still
// show up in protocol accounting. Without FEE_WALLET it stays quiet and
// fabricates nothing.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH } from '@loaded/core';
import { getNativeBalance, isValidAddress } from '@loaded/evm';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

/** Redis key: last observed ETH balance of the fee wallet (wei) */
const REDIS_LAST_FEE_KEY = 'loaded:fees:last_fee_wei';

/** Ignore dust below 0.00001 ETH (a few cents — below any real fee claim) */
const MIN_INFLOW_WEI = WEI_PER_ETH / 100_000n;

interface FeeClaimJobData {
  tokenId?: number;
}

function feeWallet(): string | null {
  const addr = (process.env.FEE_WALLET ?? '').trim();
  return addr && isValidAddress(addr) ? addr : null;
}

/**
 * Watch the fee wallet's ETH balance. Any increase since the last check
 * is treated as claimed PONS creator fees and recorded as a real
 * pool inflow. Decreases just reset the watermark — outflows are
 * protocol operations recorded elsewhere.
 */
async function processFeeWatch(_job: Job<FeeClaimJobData>): Promise<void> {
  const wallet = feeWallet();
  if (!wallet) {
    // No dedicated fee wallet configured — nothing real to watch.
    return;
  }

  const current = await getNativeBalance(wallet);

  const lastRaw = await redisConnection.get(REDIS_LAST_FEE_KEY);
  if (lastRaw === null) {
    // First run — set the watermark, record nothing retroactively.
    await redisConnection.set(REDIS_LAST_FEE_KEY, current.toString());
    console.log(`${PREFIX} fee-wallet watermark initialized at ${current} wei`);
    return;
  }

  const last = BigInt(lastRaw);

  if (current <= last) {
    if (current < last) {
      // Outflow (sweep to pool, ops) — reset watermark, record nothing.
      await redisConnection.set(REDIS_LAST_FEE_KEY, current.toString());
    }
    return;
  }

  const inflow = current - last;
  if (inflow < MIN_INFLOW_WEI) return;

  await prisma.poolLedger.create({
    data: {
      type: 'fee_claim',
      amount: inflow,
      txHash: null, // aggregated balance delta — no single tx
    },
  });
  await redisConnection.set(REDIS_LAST_FEE_KEY, current.toString());

  console.log(
    `${PREFIX} 💰 Recorded ${(Number(inflow) / 1e18).toFixed(4)} ETH of claimed creator fees into the pool ledger`,
  );
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const feeClaimerWorker = new Worker<FeeClaimJobData>(
  QUEUE_NAMES.FEE_CLAIMS,
  processFeeWatch,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

feeClaimerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

feeClaimerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

/** Schedule the fee watch every 5 minutes. */
export async function scheduleFeeClaimer(): Promise<void> {
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  await feeClaimsQueue.add(
    'watch-fees',
    {},
    {
      repeat: { every: 5 * 60 * 1000 },
      attempts: 1,
    },
  );

  console.log(`${PREFIX} Scheduled fee watch every 5 minutes`);
}
