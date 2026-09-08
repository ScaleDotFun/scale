// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee Claimer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Collects the PONS creator fees our listed coins earn. This is a real
// two-transaction job, not bookkeeping.
//
// Fees do NOT arrive on their own. They accrue inside each coin's bonding
// curve; PONS's keeper flushes them into a shared escrow vault as a credit to
// the recipient; and only a CLAIM sent BY that recipient turns the credit into
// native ETH. claim() pays msg.sender and takes no beneficiary argument, so
// nobody can collect for us — and we cannot flush for ourselves either: the
// curve's flush is keeper-gated and reverts (0x8d42130c) for every other
// caller. So this worker does exactly the half that is ours: watch the vault
// credit, and claim it.
//
// The evidence for that shape: on one live curve, 142 fee-bearing trades
// accrued 0.1321 ETH while the recipient's balance never moved; and ~887 ETH
// sits credited-but-unclaimed in the vault, which is exactly what accumulates
// when a beneficiary never runs step 2. An earlier version of this worker
// assumed fees simply landed and only compared balances — against a wallet
// that will never move on its own, it would have booked nothing, forever.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH } from '@loaded/core';
import {
  getNativeBalance,
  getProtocolAccount,
  hasProtocolKey,
  protocolPublicKey,
  claimVaultCredit,
  vaultCreditOf,
  explorerTxUrl,
} from '@loaded/evm';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

/** Ignore dust below 0.00001 ETH — below any real fee claim. */
const MIN_CLAIM_WEI = WEI_PER_ETH / 100_000n;

/**
 * Gas floor. A flush costs ~0.00002 ETH and a claim ~0.000009 ETH, but the
 * base fee on this chain has spiked ~10x for minutes at a time, so keep enough
 * headroom that a spike cannot leave the pool unable to run its own collection.
 */
const MIN_GAS_TO_OPERATE = WEI_PER_ETH / 2_000n; // 0.0005 ETH

const fmt = (wei: bigint) => `${(Number(wei) / 1e18).toFixed(6)} ETH`;

interface FeeClaimJobData {
  tokenId?: number;
}

/**
 * Claim whatever the vault has credited to the pool wallet.
 *
 * Safe to run on a schedule and safe to retry: a claim with nothing credited
 * is a no-op, and a failed claim leaves the credit untouched in the vault.
 */
async function processFeeClaim(_job: Job<FeeClaimJobData>): Promise<void> {
  const pool = protocolPublicKey();
  if (!pool) return;

  if (!hasProtocolKey()) {
    // Read-only: we can still say what is waiting, which is worth knowing.
    const credited = await vaultCreditOf(pool).catch(() => 0n);
    if (credited > 0n) {
      console.error(
        `${PREFIX} CRITICAL: ${fmt(credited)} of creator fees are credited to the pool wallet but ` +
        `PROTOCOL_WALLET_PRIVATE_KEY is not set, so they cannot be claimed.`,
      );
    }
    return;
  }

  const account = getProtocolAccount();
  const gas = await getNativeBalance(account.address);

  if (gas < MIN_GAS_TO_OPERATE) {
    const credited = await vaultCreditOf(pool).catch(() => 0n);
    // The bootstrap trap, stated plainly: claiming costs gas, and only the
    // beneficiary can claim, so a wallet at zero cannot fund itself.
    console.warn(
      `${PREFIX} pool wallet holds ${fmt(gas)} — below the ${fmt(MIN_GAS_TO_OPERATE)} needed to send a ` +
      `claim. ${credited > 0n ? `${fmt(credited)} of fees are waiting in the vault. ` : ''}` +
      `Send the pool wallet a small amount of ETH to unblock collection.`,
    );
    return;
  }

  // PONS's keeper does the flushing. We only collect.
  const credited = await vaultCreditOf(pool).catch(() => 0n);
  if (credited < MIN_CLAIM_WEI) return;

  console.log(`${PREFIX} ${fmt(credited)} credited in the vault — claiming`);

  let claim: { txHash: string; received: bigint } | null;
  try {
    claim = await claimVaultCredit(account);
  } catch (err) {
    console.error(`${PREFIX} vault claim failed:`, err instanceof Error ? err.message : err);
    throw err; // let BullMQ retry — the credit stays in the vault, nothing is lost
  }
  if (!claim) return;

  await prisma.poolLedger.create({
    data: {
      type: 'fee_claim',
      amount: claim.received,
      txHash: claim.txHash,
    },
  });

  console.log(
    `${PREFIX} 💰 Claimed ${fmt(claim.received)} of PONS creator fees into the pool — ` +
    `${explorerTxUrl(claim.txHash)}`,
  );
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const feeClaimerWorker = new Worker<FeeClaimJobData>(
  QUEUE_NAMES.FEE_CLAIMS,
  processFeeClaim,
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

/** Schedule the recurring fee sweep. */
export async function scheduleFeeClaimer(): Promise<void> {
  await feeClaimsQueue.add(
    'sweep-fees',
    {},
    { repeat: { every: 5 * 60_000 }, jobId: 'fee-sweep-recurring' },
  );
  console.log(`${PREFIX} Scheduled vault fee claim every 5 minutes`);
}
