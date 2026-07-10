// ──────────────────────────────────────────────
// SCALE PROTOCOL — Fee Claimer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// On Solana this claimed pump.fun creator fees via the Pump SDK.
// On Robinhood Chain, creator fees come from Noxa (fun.noxa.fi):
// creators redirect their token's fee stream to the protocol wallet
// and fees arrive as WETH claims. Noxa does not publish its fee
// distributor contracts or a claim API yet, so there is nothing this
// worker can truthfully claim on its own.
//
// What it DOES do — honestly — is watch the protocol wallet's WETH
// balance and record real inflows into the pool ledger, so fees the
// team claims manually on Noxa still show up in protocol accounting.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import {
  getProtocolAccount,
  hasEvmProtocolKey,
  erc20Balance,
  CONTRACTS,
} from '@scale/evm';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';

const PREFIX = '[fee-claimer]';

/** Redis key: last observed WETH balance of the protocol wallet (wei) */
const REDIS_LAST_WETH_KEY = 'scale:fees:last_weth_wei';

/** Ignore dust below 0.00001 ETH */
const MIN_INFLOW_WEI = 10_000_000_000_000n;

interface FeeClaimJobData {
  tokenId?: number;
}

/**
 * Watch the protocol wallet's WETH balance. Any increase since the last
 * check is treated as claimed creator fees (Noxa pays fees in WETH) and
 * recorded as a real pool inflow. Decreases just reset the watermark —
 * outflows are protocol operations recorded elsewhere.
 */
async function processFeeWatch(_job: Job<FeeClaimJobData>): Promise<void> {
  if (!hasEvmProtocolKey()) {
    // No EVM pool wallet yet — nothing real to watch.
    return;
  }

  const wallet = getProtocolAccount().address;
  const current = await erc20Balance(CONTRACTS.WETH, wallet);

  const lastRaw = await redisConnection.get(REDIS_LAST_WETH_KEY);
  if (lastRaw === null) {
    // First run — set the watermark, record nothing retroactively.
    await redisConnection.set(REDIS_LAST_WETH_KEY, current.toString());
    console.log(`${PREFIX} WETH watermark initialized at ${current} wei`);
    return;
  }

  const last = BigInt(lastRaw);
  if (current > last && current - last >= MIN_INFLOW_WEI) {
    const inflow = current - last;
    await prisma.poolLedger.create({
      data: {
        type: 'fee_claim',
        amount: inflow,
        txSignature: null, // aggregate balance delta — individual txs on Blockscout
      },
    });
    console.log(
      `${PREFIX} Recorded WETH fee inflow: ${(Number(inflow) / 1e18).toFixed(6)} WETH (${last} → ${current})`,
    );
  }

  if (current !== last) {
    await redisConnection.set(REDIS_LAST_WETH_KEY, current.toString());
  }
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

/**
 * Schedule the WETH fee watch every 5 minutes.
 */
export async function scheduleFeeClaimer(): Promise<void> {
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  await feeClaimsQueue.add(
    'watch-weth-fees',
    {},
    {
      repeat: { every: 5 * 60 * 1000 },
      attempts: 1,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  );

  console.log(`${PREFIX} Scheduled WETH fee watch every 5 minutes (Noxa auto-claim pending their contract docs)`);
}
