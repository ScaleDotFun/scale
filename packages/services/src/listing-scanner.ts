// ──────────────────────────────────────────────
// LOADED PROTOCOL — Listing Scanner Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Enforces the listing deal ON-CHAIN (same gate the API /tokens/list uses):
//   • checkAndListToken(addr): lists a coin only once its PONS creator fees
//     are provably arriving at the LOADED pool wallet (or the coin is on the
//     LOADED_VERIFIED_TOKENS admin allowlist).
//
//     On PONS the creator fee stream is all-or-nothing at the "Creator wallet"
//     field: it either points at the pool — in which case the creator's entire
//     share reaches us — or it does not and we receive nothing. There is no
//     partial split to measure, so the gate verifies the only thing that
//     actually matters: that the money shows up. A creator who flips "Holder
//     fee sharing" on diverts the stream to holders and stops verifying.
//   • Periodic scan: RE-VERIFIES every active listing and deactivates
//     any whose creator later re-routed rewards away from the pool —
//     nobody keeps a leverage listing without paying for it. Dead
//     rugs (liquidity collapsed) are delisted too.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { determineTier } from '@loaded/core';
import {
  verifyCreatorFeeShare,
  getTokenInfo,
  protocolPublicKey,
  isValidAddress,
} from '@loaded/evm';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';

/** Admin allowlist of extra mints that may list without the share gate. */
function verifiedTokens(): string[] {
  return (process.env.LOADED_VERIFIED_TOKENS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => isValidAddress(s));
}

interface ListingScanJobData {
  /** When set, only scan a specific token mint */
  mint?: string;
}

/**
 * List (or reactivate) a coin after verifying the creator-reward share
 * ON-CHAIN — same gate as POST /tokens/list. Metadata rides along from
 * the same verification lookup.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  if (!isValidAddress(mint)) {
    console.warn(`${PREFIX} Skipping ${mint} — not a Robinhood Chain (hex) mint`);
    return false;
  }

  const pool = protocolPublicKey();
  const allowlisted = verifiedTokens().includes(mint);
  if (!pool && !allowlisted) return false;

  let creator: string | null = null;
  let name: string | null = null;
  let symbol: string | null = null;
  let imageUri: string | null = null;
  let marketCapUsd = 0;
  let liquidityUsd = 0;
  let graduated = false;

  try {
    const check = await verifyCreatorFeeShare(mint, pool ?? '');
    if (check.status !== 'verified' && !allowlisted) {
      // quiet skip — discovery sweeps hundreds of unonboarded coins
      return false;
    }
    if (check.token) {
      creator = null;
      name = check.token.name ?? null;
      symbol = check.token.symbol ?? null;
      imageUri = check.token.imageUri ?? null;
      marketCapUsd = check.token.marketCap ?? 0;
      liquidityUsd = check.token.liquidity ?? 0;
      graduated = check.graduated ?? false;
    }
  } catch (err) {
    console.warn(`${PREFIX} ${mint} verification read failed:`, err instanceof Error ? err.message : err);
    return false;
  }

  // Reactivation and fresh listing both require a live market — a coin with
  // a verified reward share but collapsed liquidity must stay delisted, or
  // it flaps: self-heal reactivates it, the liquidity check strikes it out,
  // repeat forever.
  const tierConfig = determineTier(marketCapUsd, liquidityUsd, graduated);

  const existing = await prisma.token.findUnique({ where: { address: mint } });
  if (existing) {
    if (!existing.isActive && tierConfig) {
      await prisma.token.update({ where: { id: existing.id }, data: { isActive: true } });
      console.log(`${PREFIX} Reactivated ${existing.symbol ?? mint} (reward share re-verified, liq $${liquidityUsd.toFixed(0)})`);
      return true;
    }
    return false; // active already, or still too illiquid to bring back
  }

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
      creatorWallet: creator ?? pool ?? mint, // real PONS dev when verified
      tier: tierConfig.tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Listed ${symbol ?? mint} (tier: ${tierConfig.tier}, liq: $${liquidityUsd.toFixed(0)}, share verified)`,
  );
  return true;
}

/**
 * Periodic scan:
 *   1. Sweep the admin allowlist for anything not yet listed.
 *   2. RE-VERIFY every active listing's reward share on-chain and
 *      deactivate coins whose creator re-routed rewards away. Dead
 *      liquidity delists too. Read failures keep the listing — only
 *      positive signal deactivates.
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

  // 2. re-verify active listings
  const pool = protocolPublicKey();
  if (!pool) return;
  const allow = new Set(verifiedTokens());
  const LOADED_MINT = (process.env.LOADED_TOKEN_MINT || '').trim();
  const active = await prisma.token.findMany({ where: { isActive: true } });

  for (const token of active) {
    if (token.address === LOADED_MINT || allow.has(token.address)) continue; // exempt
    try {
      const check = await verifyCreatorFeeShare(token.address, pool);
      if (check.status !== 'verified') {
        // Hysteresis: one bad read is not proof — bonding-curve graduation
        // and RPC lag both produce transient non-verified reads (LOADED
        // itself got wrongly delisted mid-graduation). Three consecutive
        // failing sweeps before we pull a listing.
        if (recordStrike(token.address) < DEACTIVATE_STRIKES) continue;
        await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
        console.warn(
          `${PREFIX} ⛔ Deactivated ${token.symbol ?? token.address} — reward share now ${check.status} ` +
          `(${DEACTIVATE_STRIKES} consecutive sweeps)`,
        );
        continue;
      }
      // still paying — also delist if liquidity has fully collapsed
      const info = check.token ?? (await getTokenInfo(token.address).catch(() => null));
      if (info) {
        const mcap = info.marketCap ?? 0;
        const liq = info.liquidity ?? 0;
        const graduated = check.graduated;
        if (determineTier(mcap, liq, graduated) === null) {
          if (recordStrike(token.address) < DEACTIVATE_STRIKES) continue;
          await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
          console.warn(
            `${PREFIX} ⛔ Deactivated ${token.symbol ?? token.address} — liquidity collapsed ($${liq.toFixed(0)}, ${DEACTIVATE_STRIKES} consecutive sweeps)`,
          );
          continue;
        }
      }
      clearStrikes(token.address); // healthy sweep resets the streak
    } catch (err) {
      // chain read hiccup — keep the listing, retry next sweep
      console.warn(`${PREFIX} re-verify failed for ${token.address}:`, err instanceof Error ? err.message : err);
    }
  }

  // 3. self-healing: re-check recently deactivated coins for recovery.
  //    A coin wrongly delisted (graduation window, RPC lag) or whose creator
  //    re-enabled the reward share comes back automatically —
  //    checkAndListToken reactivates existing rows on a verified read.
  //    Newest first, capped per sweep to bound RPC load.
  const inactive = await prisma.token.findMany({
    where: { isActive: false, address: { endsWith: 'pump' } },
    orderBy: { id: 'desc' },
    take: 10,
    select: { address: true },
  });
  for (const t of inactive) {
    try {
      await checkAndListToken(t.address);
    } catch {
      /* quiet — next sweep retries */
    }
  }
}

// Deactivation hysteresis — in-memory strike counter per mint. Resets on
// process restart, which only makes delisting slower, never wrong.
const DEACTIVATE_STRIKES = 3;
const strikeCounts = new Map<string, number>();
function recordStrike(mint: string): number {
  const n = (strikeCounts.get(mint) ?? 0) + 1;
  strikeCounts.set(mint, n);
  return n;
}
function clearStrikes(mint: string): void {
  strikeCounts.delete(mint);
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
