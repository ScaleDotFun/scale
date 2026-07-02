// ──────────────────────────────────────────────
// FRONT PROTOCOL — Fee Claimer Worker
// ──────────────────────────────────────────────
//
// Claims creator fees from pump.fun tokens using the official Pump SDK.
// Fees accumulate on-chain and need to be claimed via a distribute
// instruction. This worker handles that automatically.
//
// Uses: @pump-fun/pump-sdk for instruction building
//       PumpSdk.distributeCreatorFees() or distributeCreatorFeesV2()
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL, formatSol } from '@front-protocol/core';
import { getConnection, getProtocolWallet, PublicKey, getSolBalance } from '@front-protocol/solana';
import { redisConnection, QUEUE_NAMES, feeClaimsQueue } from './queues.js';
import { createRequire } from 'node:module';
import {
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

// pump-sdk is CJS-only — use createRequire for ESM compatibility
let feeSharingConfigPda: any = null;
let creatorVaultPda: any = null;
let bondingCurvePda: any = null;
let PumpSdkClass: any = null;
try {
  const require = createRequire(import.meta.url);
  const pumpSdk = require('@pump-fun/pump-sdk');
  feeSharingConfigPda = pumpSdk.feeSharingConfigPda;
  creatorVaultPda = pumpSdk.creatorVaultPda;
  bondingCurvePda = pumpSdk.bondingCurvePda;
  PumpSdkClass = pumpSdk.PumpSdk;
} catch {
  console.warn('[fee-claimer] @pump-fun/pump-sdk not available');
}

const PREFIX = '[fee-claimer]';
const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

// Minimum claim threshold (0.001 SOL)
const MIN_CLAIM_LAMPORTS = BigInt(1_000_000);

interface FeeClaimJobData {
  tokenId?: number;
}

/**
 * Check if a token has a fee sharing config on-chain.
 */
async function hasSharingConfig(mint: string): Promise<boolean> {
  try {
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const sharingPda = feeSharingConfigPda(mintPubkey);
    const info = await connection.getAccountInfo(sharingPda);
    return info !== null;
  } catch {
    return false;
  }
}

/**
 * Get the unclaimed fee balance for a token's creator vault.
 */
async function getUnclaimedFees(mint: string): Promise<bigint> {
  try {
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);

    // Check bonding curve balance (fees accumulate here for non-graduated tokens)
    const bcPda = bondingCurvePda(mintPubkey);
    const bcInfo = await connection.getAccountInfo(bcPda);

    // Also check creator vault PDA
    const cvPda = creatorVaultPda(mintPubkey);
    const cvInfo = await connection.getAccountInfo(cvPda);

    let totalUnclaimed = BigInt(0);
    if (bcInfo) {
      // The bonding curve account holds the reserves + fees
      // We can't easily separate fees from reserves here,
      // so we'll try the distribute instruction and see what we get
      totalUnclaimed += BigInt(bcInfo.lamports);
    }
    if (cvInfo) {
      totalUnclaimed += BigInt(cvInfo.lamports);
    }

    return totalUnclaimed;
  } catch {
    return BigInt(0);
  }
}

/**
 * Claim fees for a specific token by calling the pump.fun distribute instruction.
 * 
 * The SDK's distributeCreatorFees() requires named params:
 *   { mint, sharingConfig, sharingConfigAddress }
 * We must first fetch and decode the sharing config PDA.
 */
async function claimFeesForToken(
  tokenAddress: string,
  tokenSymbol: string,
): Promise<{ txSignature: string; feesClaimed: bigint } | null> {
  const connection = getConnection();
  const protocolWallet = getProtocolWallet();
  const mintPubkey = new PublicKey(tokenAddress);

  try {
    const pumpSdk = new PumpSdkClass();

    // Step 1: Fetch and decode the sharing config
    const sharingConfigAddress = feeSharingConfigPda(mintPubkey);
    const sharingAccountInfo = await connection.getAccountInfo(sharingConfigAddress);

    if (!sharingAccountInfo) {
      console.log(`${PREFIX} No sharing config for ${tokenSymbol} — skipping`);
      return null;
    }

    const sharingConfig = pumpSdk.decodeSharingConfig(sharingAccountInfo);

    // Verify protocol wallet is a shareholder
    const isOurToken = sharingConfig.shareholders.some(
      (sh: any) => sh.address.toBase58() === PROTOCOL_WALLET,
    );
    if (!isOurToken) {
      console.log(`${PREFIX} Protocol wallet not a shareholder for ${tokenSymbol} — skipping`);
      return null;
    }

    // Step 2: Get SOL balance before claiming
    const balBefore = await connection.getBalance(new PublicKey(PROTOCOL_WALLET));

    // Step 3: Build the distribute instruction with correct params
    let ix;
    try {
      ix = await pumpSdk.distributeCreatorFees({
        mint: mintPubkey,
        sharingConfig: sharingConfig as any,
        sharingConfigAddress,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${PREFIX} Cannot build claim ix for ${tokenSymbol}: ${msg}`);
      return null;
    }

    if (!ix) {
      console.log(`${PREFIX} No claim instruction generated for ${tokenSymbol}`);
      return null;
    }

    // Step 4: Build and send the transaction
    const tx = new Transaction();
    if (Array.isArray(ix)) {
      for (const i of ix) tx.add(i);
    } else {
      tx.add(ix);
    }

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = protocolWallet.publicKey;

    const txSignature = await sendAndConfirmTransaction(connection, tx, [protocolWallet], {
      commitment: 'confirmed',
      maxRetries: 3,
    });

    // Step 5: Measure balance delta
    await new Promise((r) => setTimeout(r, 3000));
    const balAfter = await connection.getBalance(new PublicKey(PROTOCOL_WALLET));
    const deltaLamports = balAfter - balBefore;
    const feesClaimed = deltaLamports > 0 ? BigInt(deltaLamports) : BigInt(0);

    if (feesClaimed > BigInt(0)) {
      console.log(
        `${PREFIX} ✅ Claimed ${Number(feesClaimed) / 1e9} SOL from ${tokenSymbol} (tx: ${txSignature})`,
      );
    } else {
      console.log(`${PREFIX} Claim tx sent for ${tokenSymbol} but 0 SOL received (tx: ${txSignature})`);
    }

    return { txSignature, feesClaimed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Claim failed for ${tokenSymbol}: ${msg}`);
    return null;
  }
}

/**
 * Process fee claim job: iterate all active tokens and claim fees.
 */
async function processFeeClaimJob(job: Job<FeeClaimJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting fee claim run (job ${job.id})`);

  try {
    const tokens = await prisma.token.findMany({
      where: job.data.tokenId ? { id: job.data.tokenId, isActive: true } : { isActive: true },
      select: { id: true, address: true, symbol: true, totalFeesClaimed: true },
    });

    if (tokens.length === 0) {
      console.log(`${PREFIX} No active tokens to process`);
      return;
    }

    console.log(`${PREFIX} Processing ${tokens.length} active token(s)`);

    let totalClaimed = BigInt(0);
    let claimsExecuted = 0;

    for (const token of tokens) {
      try {
        const result = await claimFeesForToken(token.address, token.symbol ?? 'Unknown');
        if (!result || result.feesClaimed <= BigInt(0)) continue;

        // Record in database
        await prisma.$transaction([
          prisma.feeClaim.create({
            data: {
              tokenId: token.id,
              amount: result.feesClaimed,
              txSignature: result.txSignature,
            },
          }),
          prisma.token.update({
            where: { id: token.id },
            data: {
              totalFeesClaimed: token.totalFeesClaimed + result.feesClaimed,
            },
          }),
          prisma.poolLedger.create({
            data: {
              type: 'fee_claim',
              amount: result.feesClaimed,
              referenceId: token.id,
              txSignature: result.txSignature,
            },
          }),
        ]);

        totalClaimed += result.feesClaimed;
        claimsExecuted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error claiming for ${token.symbol}: ${msg}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Fee claim run complete: ${claimsExecuted} claim(s), ` +
      `${formatSol(totalClaimed)} SOL total (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Fatal error in fee claim job: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const feeClaimerWorker = new Worker<FeeClaimJobData>(
  QUEUE_NAMES.FEE_CLAIMS,
  processFeeClaimJob,
  {
    connection: redisConnection,
    concurrency: 1,
    limiter: { max: 1, duration: 5000 },
  },
);

feeClaimerWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

feeClaimerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

feeClaimerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

export async function scheduleFeeClaimer(): Promise<void> {
  const existing = await feeClaimsQueue.getRepeatableJobs();
  for (const job of existing) {
    await feeClaimsQueue.removeRepeatableByKey(job.key);
  }

  // Run every 10 minutes
  const intervalMs = 10 * 60 * 1000;

  await feeClaimsQueue.add(
    'claim-all-fees',
    {},
    {
      repeat: { every: intervalMs },
      attempts: 3,
      backoff: { type: 'exponential', delay: 30_000 },
    },
  );

  console.log(`${PREFIX} Scheduled fee claims every 10 minutes`);
}
