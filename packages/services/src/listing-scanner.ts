// ──────────────────────────────────────────────
// FRONT PROTOCOL — Listing Scanner Worker
// ──────────────────────────────────────────────
//
// Automatically discovers and lists tokens whose creators have directed
// their pump.fun fee-sharing config to the Front Protocol wallet.
//
// Strategy:
//   1. Periodic scan: fetch latest pump.fun tokens, check fee_recipient
//   2. Re-verify existing listed tokens to deactivate any that removed fees
//   3. Only list tokens where fee_recipient === PROTOCOL_WALLET
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import { determineTier } from '@front-protocol/core';
import { getConnection, PublicKey } from '@front-protocol/solana';
import { createRequire } from 'node:module';

// pump-sdk is CJS-only — use createRequire for ESM compat
let feeSharingConfigPda: ((mint: InstanceType<typeof PublicKey>) => InstanceType<typeof PublicKey>) | null = null;
let PumpSdkClass: (new () => { decodeSharingConfig: (info: any) => any }) | null = null;
try {
  const require = createRequire(import.meta.url);
  const pumpSdk = require('@pump-fun/pump-sdk');
  feeSharingConfigPda = pumpSdk.feeSharingConfigPda;
  PumpSdkClass = pumpSdk.PumpSdk;
} catch {
  console.warn('[listing-scanner] @pump-fun/pump-sdk not available');
}
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';
const PROTOCOL_WALLET = process.env.PROTOCOL_WALLET || '2uNqHvi3RrkFaFmtBM2KT9eWBDEqoj2eomL97A2v9hoM';

interface ListingScanJobData {
  /** When set, only scan a specific mint address */
  mint?: string;
}

/**
 * Verify a token's fee redirect via on-chain sharing config + pump.fun API.
 *
 * Uses the pump SDK to derive the feeSharingConfigPda and decode it.
 * If the protocol wallet is listed as a shareholder → verified.
 */
async function verifyFeeRedirect(mint: string): Promise<{
  verified: boolean;
  name: string;
  symbol: string;
  creator: string;
  imageUri: string;
  marketCap: number;
  complete: boolean;
  feeRecipient: string | null;
} | null> {
  let verified = false;
  let feeRecipient: string | null = null;

  // ── Method 1: Check on-chain sharing config via Pump SDK ──
  if (!feeSharingConfigPda || !PumpSdkClass) {
    return null; // SDK not available
  }
  try {
    const connection = getConnection();
    const mintPubkey = new PublicKey(mint);
    const sharingPda = feeSharingConfigPda(mintPubkey);
    const sharingInfo = await connection.getAccountInfo(sharingPda);
    if (sharingInfo) {
      // Decode the sharing config to find shareholders
      try {
        const pumpSdk = new PumpSdkClass();
        const config = pumpSdk.decodeSharingConfig(sharingInfo);
        // config.shareholders is an array of { address, shareBps }
        const shareholders = (config as any).shareholders || (config as any).shares || [];
        for (const sh of shareholders) {
          const addr = sh.address?.toBase58?.() || sh.wallet?.toBase58?.() || String(sh.address || sh.wallet || '');
          if (addr === PROTOCOL_WALLET) {
            verified = true;
            feeRecipient = PROTOCOL_WALLET;
            break;
          }
        }
        if (!verified) {
          // Sharing config exists but protocol wallet is not a shareholder
          feeRecipient = shareholders.length > 0
            ? (shareholders[0].address?.toBase58?.() || String(shareholders[0].address || ''))
            : 'unknown';
        }
      } catch (decodeErr) {
        // Can't decode but account exists — might mean config is there
        console.warn(`${PREFIX} Could not decode sharing config for ${mint}: ${decodeErr}`);
      }
    }
  } catch {
    // On-chain check failed — fallback to API
  }

  // ── Method 2: Pump.fun API check ──
  try {
    const response = await fetch(`https://frontend-api-v3.pump.fun/coins/${mint}`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      // If we already verified on-chain, return that
      if (verified) {
        return { verified, name: 'Unknown', symbol: '???', creator: '', imageUri: '', marketCap: 0, complete: false, feeRecipient };
      }
      return null;
    }

    const data = await response.json() as Record<string, unknown>;

    // Check API fields for fee_recipient (in case pump.fun adds it)
    if (!verified) {
      const apiRecipient = (data.fee_recipient as string) || (data.creator_fee_wallet as string) || null;
      if (apiRecipient === PROTOCOL_WALLET) {
        verified = true;
        feeRecipient = PROTOCOL_WALLET;
      } else if (apiRecipient) {
        feeRecipient = apiRecipient;
      }
    }

    return {
      verified,
      name: (data.name as string) || 'Unknown',
      symbol: (data.symbol as string) || '???',
      creator: (data.creator as string) || '',
      imageUri: (data.image_uri as string) || '',
      marketCap: (data.usdMarketCap as number) || (data.usd_market_cap as number) || 0,
      complete: (data.complete as boolean) || false,
      feeRecipient,
    };
  } catch {
    if (verified) {
      return { verified, name: 'Unknown', symbol: '???', creator: '', imageUri: '', marketCap: 0, complete: false, feeRecipient };
    }
    return null;
  }
}

/**
 * Process a listing scan job.
 * 1. Scans latest pump.fun tokens for new fee-verified listings
 * 2. Re-verifies existing listed tokens
 */
async function processListingScan(job: Job<ListingScanJobData>): Promise<void> {
  const startTime = Date.now();
  console.log(`${PREFIX} Starting listing scan (job ${job.id})`);

  try {
    // If a specific mint is provided, only check that one
    if (job.data.mint) {
      await checkAndListToken(job.data.mint);
      return;
    }

    // ── Part 1: Scan for new tokens ──
    console.log(`${PREFIX} Scanning latest pump.fun tokens...`);
    let newListings = 0;

    try {
      const response = await fetch('https://frontend-api-v3.pump.fun/coins/latest', {
        signal: AbortSignal.timeout(15_000),
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const data = await response.json() as Array<Record<string, unknown>>;
        if (Array.isArray(data)) {
          const mints = data
            .map((t) => (t.mint as string) || '')
            .filter((m) => m.length > 0);

          console.log(`${PREFIX} Fetched ${mints.length} latest token(s)`);

          const MAX_NEW_PER_SCAN = 10;
          for (const mint of mints) {
            if (newListings >= MAX_NEW_PER_SCAN) break;
            try {
              const listed = await checkAndListToken(mint);
              if (listed) newListings++;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(`${PREFIX} Error checking ${mint.substring(0, 8)}…: ${msg}`);
            }
          }
        }
      } else {
        console.warn(`${PREFIX} Pump.fun API returned ${response.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${PREFIX} Failed to fetch latest tokens: ${msg}`);
    }

    // ── Part 2: Re-verify existing listed tokens ──
    // Only deactivate if we can CONFIRM fees are going somewhere else.
    // If pump.fun API doesn't expose fee_recipient (null), keep the token active.
    console.log(`${PREFIX} Re-verifying existing listed tokens...`);
    let deactivated = 0;
    let reactivated = 0;

    const existingTokens = await prisma.token.findMany({
      where: {},
      select: { id: true, address: true, symbol: true, isActive: true },
    });

    for (const token of existingTokens) {
      try {
        const result = await verifyFeeRedirect(token.address);
        if (!result) {
          // API unavailable — don't change anything
          console.warn(`${PREFIX} Could not verify ${token.symbol} — API unavailable, keeping current state`);
          continue;
        }

        if (result.verified && !token.isActive) {
          // Fees confirmed going to protocol — reactivate
          await prisma.token.update({
            where: { id: token.id },
            data: { isActive: true },
          });
          reactivated++;
          console.log(`${PREFIX} ♻️ Reactivated ${token.symbol} — fees confirmed going to protocol`);
        } else if (!result.verified && result.feeRecipient && result.feeRecipient !== '' && token.isActive) {
          // Fee recipient is CONFIRMED going to a different wallet — deactivate
          await prisma.token.update({
            where: { id: token.id },
            data: { isActive: false },
          });
          deactivated++;
          console.log(
            `${PREFIX} ❌ Deactivated ${token.symbol} — fee_recipient is "${result.feeRecipient}", not protocol wallet`,
          );
        } else if (!result.verified && !result.feeRecipient) {
          // fee_recipient not exposed by API — can't verify, keep current state
          console.log(`${PREFIX} ⏭ ${token.symbol} — fee_recipient not exposed by API, keeping active`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Re-verify error for ${token.symbol}: ${msg}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Scan complete: ${newListings} new, ${deactivated} deactivated, ${reactivated} reactivated (${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Listing scan error: ${msg}`);
    throw err;
  }
}

/**
 * Check a specific token's fee redirect and auto-list if verified.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  // Check if already listed
  const existing = await prisma.token.findUnique({
    where: { address: mint },
    select: { id: true, isActive: true },
  });

  if (existing) return false;

  // Verify fee redirect on pump.fun
  const result = await verifyFeeRedirect(mint);
  if (!result) {
    return false;
  }

  if (!result.verified) {
    // Fee not redirected to protocol — skip silently
    return false;
  }

  // ✅ Fee verified — auto-list the token
  // Determine tier from market cap
  const tierConfig = determineTier(result.marketCap, result.marketCap * 0.1, result.complete);
  const tier = tierConfig ? tierConfig.tier : 'degen';

  // Fetch DexScreener for better liquidity data
  let imageUri = result.imageUri;
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (dexRes.ok) {
      const dexData = await dexRes.json() as any;
      const pairs = dexData.pairs || [];
      if (pairs.length > 0) {
        const bestPair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
        imageUri = bestPair.info?.imageUrl || imageUri;
      }
    }
  } catch {
    // Use pump.fun image as fallback
  }

  await prisma.token.create({
    data: {
      address: mint,
      name: result.name,
      symbol: result.symbol,
      imageUri,
      creatorWallet: result.creator,
      tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Auto-listed ${result.symbol} (${result.name}) | ` +
    `tier=${tier} | fee_recipient=${PROTOCOL_WALLET.substring(0, 8)}… | ` +
    `mcap=$${result.marketCap.toLocaleString()}`,
  );

  return true;
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const listingScannerWorker = new Worker<ListingScanJobData>(
  QUEUE_NAMES.LISTING_SCAN,
  processListingScan,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

listingScannerWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed`);
});

listingScannerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

listingScannerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Exports for manual listing check
// ──────────────────────────────────────────────

export { checkAndListToken };
