// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee Claimer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Keeps the pool ledger honest about money that arrives on its own.
//
// There is no "claim" step on PONS: a creator who points their Creator wallet
// at the LOADED pool wallet redirects the fee stream at the protocol level, so
// their share simply lands as ordinary ETH credits from the coin's bonding
// curve. Nothing to call, and no event log tying a credit to a coin.
//
// So instead of trying to claim or attribute, this worker reconciles: every
// deliberate flow writes a poolLedger row, so whatever the wallet holds beyond
// the ledger's sum is income that arrived by itself. It books the difference.
// Set FEE_WALLET to watch a separate address instead of the pool.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH } from '@loaded/core';
import { getNativeBalance, isValidAddress, protocolPublicKey } from '@loaded/evm';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

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
 * Reconcile the pool wallet against the pool ledger.
 *
 * There is nothing to "claim" from PONS. A creator who points their Creator
 * wallet at us is redirecting the fee stream at the protocol level, so the
 * money simply arrives — as plain ETH credits from each coin's bonding curve,
 * with no claim call to make and no event log to match against a coin.
 *
 * What was missing was recording it. Every deliberate flow already writes a
 * poolLedger row, so anything the wallet holds beyond the ledger's sum is
 * income that arrived on its own: creator fees, mostly. Booking the difference
 * keeps the ledger honest without inventing a per-coin attribution the chain
 * cannot support.
 *
 * This replaces a Redis balance watermark, which lost any inflow that shared a
 * polling window with an outflow (a balance snapshot cannot tell those apart)
 * and silently dropped an interval whenever the key was evicted. A difference
 * recomputed from durable state each tick has neither failure mode.
 */
async function processFeeWatch(_job: Job<FeeClaimJobData>): Promise<void> {
  // An explicitly configured fee wallet still takes precedence, for setups
  // that route fees somewhere separate from the trading pool.
  const watched = feeWallet() ?? protocolPublicKey();
  if (!watched) return;

  const [onchain, ledgerAgg] = await Promise.all([
    getNativeBalance(watched),
    prisma.poolLedger.aggregate({ _sum: { amount: true } }),
  ]);
  const ledger = ledgerAgg._sum.amount ?? 0n;
  const unaccounted = onchain - ledger;

  if (unaccounted < MIN_INFLOW_WEI) {
    if (unaccounted < 0n) {
      // The wallet holds LESS than the books say. Never book a negative here:
      // an in-flight transaction looks exactly like this for a few seconds.
      // Worth saying out loud if it persists, though.
      console.warn(
        `${PREFIX} pool wallet is ${(Number(-unaccounted) / 1e18).toFixed(6)} ETH below the ledger — ` +
        `expected briefly while a transaction settles, investigate if it persists`,
      );
    }
    return;
  }

  await prisma.poolLedger.create({
    data: {
      type: 'pool_reconcile',
      amount: unaccounted,
      txHash: null, // arrived as ordinary credits; no single transaction to cite
    },
  });

  console.log(
    `${PREFIX} 💰 Booked ${(Number(unaccounted) / 1e18).toFixed(6)} ETH of unaccounted pool income ` +
    `(creator fees) — ledger now matches the wallet at ${(Number(onchain) / 1e18).toFixed(6)} ETH`,
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
