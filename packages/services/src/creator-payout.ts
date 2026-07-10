// ──────────────────────────────────────────────
// FRONT PROTOCOL — Creator Payout Worker
// ──────────────────────────────────────────────
//
// Records creator payout entitlements when positions close profitably.
// Actual SOL transfer happens when the creator claims via the API.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import { formatSol } from '@scale/core';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[creator-payout]';

interface CreatorPayoutJobData {
  tokenId: number;
  creatorWallet: string;
  amountLamports: string; // bigint serialized as string
  positionId: number;
}

/**
 * Process a creator payout job: record the claimable payout in the database.
 * The actual SOL transfer happens when the creator initiates a claim via the API.
 */
async function processCreatorPayout(job: Job<CreatorPayoutJobData>): Promise<void> {
  const { tokenId, creatorWallet, amountLamports: amountStr, positionId } = job.data;
  const amount = BigInt(amountStr);

  console.log(
    `${PREFIX} Recording payout for creator ${creatorWallet}: ${formatSol(amount)} ETH (position #${positionId})`,
  );

  try {
    // Load current token data for the increment
    const token = await prisma.token.findUnique({
      where: { id: tokenId },
      select: { totalCreatorPayouts: true, symbol: true },
    });

    if (!token) {
      console.error(`${PREFIX} Token #${tokenId} not found, skipping payout`);
      return;
    }

    // Record payout and update token in a transaction
    await prisma.$transaction([
      // Create claimable payout record
      prisma.creatorPayout.create({
        data: {
          tokenId,
          creatorWallet,
          amount,
          positionId,
          status: 'claimable',
        },
      }),

      // Update token's total creator payouts
      prisma.token.update({
        where: { id: tokenId },
        data: {
          totalCreatorPayouts: token.totalCreatorPayouts + amount,
        },
      }),
    ]);

    console.log(
      `${PREFIX} ✅ Created claimable payout of ${formatSol(amount)} ETH for ${creatorWallet} ` +
        `(${token.symbol ?? `token #${tokenId}`}, position #${positionId})`,
    );
    // NOTE: Actual SOL transfer happens when creator calls the claim endpoint.
    // The API will:
    //   1. Find all claimable payouts for the creator
    //   2. Execute SOL transfer from pool to creator wallet
    //   3. Update payout status to 'claimed' with claimTx and claimedAt
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `${PREFIX} Error recording payout for creator ${creatorWallet} (position #${positionId}): ${msg}`,
    );
    throw err; // Let BullMQ retry
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const creatorPayoutWorker = new Worker<CreatorPayoutJobData>(
  QUEUE_NAMES.CREATOR_PAYOUTS,
  processCreatorPayout,
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

creatorPayoutWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed (position #${job.data.positionId})`);
});

creatorPayoutWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

creatorPayoutWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});


