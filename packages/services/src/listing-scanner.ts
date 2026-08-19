// ──────────────────────────────────────────────
// SCALE PROTOCOL — Listing Scanner Worker (Solana)
// ──────────────────────────────────────────────
//
// Verifies pump.fun launches via Jupiter's token registry (same gate
// the API /tokens/list uses):
//   • checkAndListToken(mint): lists a token when Jupiter attributes it
//     to the pump.fun launchpad (or when it's on the
//     SCALE_VERIFIED_TOKENS admin allowlist). Creator = on-chain dev.
//   • Periodic scan: re-checks every ACTIVE token's market data and
//     deactivates any whose liquidity collapsed below the safe floor —
//     dead rugs don't keep leverage listings.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import { determineTier } from '@scale/core';
import {
  verifyPumpToken,
  getJupToken,
  isValidSolanaAddress,
} from '@scale/solana';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';
const PROTOCOL_WALLET = (process.env.PROTOCOL_WALLET || '').trim();

/** Admin allowlist of extra mints that may list without pump.fun attribution. */
function verifiedTokens(): string[] {
  return (process.env.SCALE_VERIFIED_TOKENS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isValidSolanaAddress(s));
}

interface ListingScanJobData {
  /** When set, only scan a specific token mint */
  mint?: string;
}

/**
 * List (or reactivate) a token after verifying it is a genuine pump.fun
 * launch — same gate as POST /tokens/list. Metadata comes from the same
 * Jupiter lookup, so one call covers verification and market data.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  if (!isValidSolanaAddress(mint)) {
    console.warn(`${PREFIX} Skipping ${mint} — not a Solana (base58) mint`);
    return false;
  }

  const allowlisted = verifiedTokens().includes(mint);

  let creator: string | null = null;
  let name: string | null = null;
  let symbol: string | null = null;
  let imageUri: string | null = null;
  let marketCapUsd = 0;
  let liquidityUsd = 0;
  let graduated = false;

  try {
    const check = await verifyPumpToken(mint);
    if (check.status !== 'verified' && !allowlisted) {
      console.log(`${PREFIX} ${mint} is ${check.status}${check.launchpad ? ` (launchpad: ${check.launchpad})` : ''} — skipping`);
      return false;
    }
    if (check.token) {
      creator = check.creator ?? null;
      name = check.token.name ?? null;
      symbol = check.token.symbol ?? null;
      imageUri = check.token.icon ?? null;
      marketCapUsd = check.token.mcap ?? check.token.fdv ?? 0;
      liquidityUsd = check.token.liquidity ?? 0;
      graduated = check.graduated ?? false;
    }
  } catch (err) {
    console.warn(`${PREFIX} ${mint} verification read failed:`, err instanceof Error ? err.message : err);
    return false;
  }

  const existing = await prisma.token.findUnique({ where: { address: mint } });
  if (existing) {
    if (!existing.isActive) {
      // verification above already passed — safe to reactivate
      await prisma.token.update({ where: { id: existing.id }, data: { isActive: true } });
      console.log(`${PREFIX} Reactivated ${existing.symbol ?? mint} (pump.fun launch re-verified)`);
      return true;
    }
    return false; // already listed and active
  }

  const tierConfig = determineTier(marketCapUsd, liquidityUsd, graduated);
  if (!tierConfig) {
    console.warn(`${PREFIX} ${mint} liquidity too low to list safely ($${liquidityUsd.toFixed(0)}) — skipping`);
    return false;
  }

  await prisma.token.create({
    data: {
      address: mint,
      name,
      symbol,
      imageUri,
      creatorWallet: creator ?? PROTOCOL_WALLET ?? mint, // real pump.fun dev when verified
      tier: tierConfig.tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Listed ${symbol ?? mint} (tier: ${tierConfig.tier}, liq: $${liquidityUsd.toFixed(0)})`,
  );
  return true;
}

/**
 * Periodic scan:
 *   1. Sweep the admin allowlist for anything not yet listed.
 *   2. Re-check every active listing's live market data and deactivate
 *      tokens whose liquidity collapsed below the safe floor. Read
 *      failures keep the listing — only positive signal deactivates.
 */
async function processScan(job: Job<ListingScanJobData>): Promise<void> {
  if (job.data.mint) {
    await checkAndListToken(job.data.mint);
    return;
  }

  // 1. allowlist sweep
  let listed = 0;
  for (const mint of verifiedTokens()) {
    try {
      if (await checkAndListToken(mint)) listed++;
    } catch (err) {
      console.error(`${PREFIX} Error listing ${mint}:`, err instanceof Error ? err.message : err);
    }
  }
  if (listed > 0) console.log(`${PREFIX} Scan complete — ${listed} new listing(s)`);

  // 2. re-check active listings' health
  const allow = new Set(verifiedTokens());
  const SCALE_MINT = (process.env.SCALE_TOKEN_MINT || '').trim();
  const active = await prisma.token.findMany({ where: { isActive: true } });

  for (const token of active) {
    if (token.address === SCALE_MINT || allow.has(token.address)) continue; // exempt
    try {
      const info = await getJupToken(token.address);
      if (!info) continue; // registry gap — keep the listing, retry next sweep
      const mcap = info.mcap ?? info.fdv ?? 0;
      const liq = info.liquidity ?? 0;
      const graduated = !!info.graduatedPool || !!info.graduatedAt;
      if (determineTier(mcap, liq, graduated) === null) {
        await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
        console.warn(
          `${PREFIX} ⛔ Deactivated ${token.symbol ?? token.address} — liquidity collapsed ` +
          `($${liq.toFixed(0)} liq, $${mcap.toFixed(0)} mcap)`,
        );
      }
    } catch (err) {
      // API hiccup — keep the listing, retry next sweep
      console.warn(`${PREFIX} re-check failed for ${token.address}:`, err instanceof Error ? err.message : err);
    }
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const listingScannerWorker = new Worker<ListingScanJobData>(
  QUEUE_NAMES.LISTING_SCAN,
  processScan,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

listingScannerWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

listingScannerWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

export { checkAndListToken };
