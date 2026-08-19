// ──────────────────────────────────────────────
// SCALE PROTOCOL — Listing Scanner Worker (Solana)
// ──────────────────────────────────────────────
//
// Enforces the listing deal ON-CHAIN via pump.fun's fee-sharing
// program (same gate the API /tokens/list uses):
//   • checkAndListToken(mint): lists a coin when its creator shares
//     ≥ SCALE_MIN_FEE_SHARE_PCT (default 100%) of creator rewards
//     with the SCALE pool wallet (or the coin is on the
//     SCALE_VERIFIED_TOKENS admin allowlist).
//   • Periodic scan: RE-VERIFIES every active listing and deactivates
//     any whose creator later re-routed rewards away from the pool —
//     nobody keeps a leverage listing without paying for it. Dead
//     rugs (liquidity collapsed) are delisted too.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import { determineTier } from '@scale/core';
import {
  verifyPumpRewardShare,
  getJupToken,
  protocolPublicKey,
  isValidSolanaAddress,
} from '@scale/solana';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';

function minFeeSharePct(): number {
  const raw = Number(process.env.SCALE_MIN_FEE_SHARE_PCT);
  return Number.isFinite(raw) ? Math.min(100, Math.max(1, raw)) : 100;
}

/** Admin allowlist of extra mints that may list without the share gate. */
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
 * List (or reactivate) a coin after verifying the creator-reward share
 * ON-CHAIN — same gate as POST /tokens/list. Metadata rides along from
 * the same verification lookup.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  if (!isValidSolanaAddress(mint)) {
    console.warn(`${PREFIX} Skipping ${mint} — not a Solana (base58) mint`);
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
    const check = await verifyPumpRewardShare(mint, pool ?? '', minFeeSharePct());
    if (check.status !== 'verified' && !allowlisted) {
      // quiet skip — discovery sweeps hundreds of unonboarded coins
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
      console.log(`${PREFIX} Reactivated ${existing.symbol ?? mint} (reward share re-verified)`);
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
      creatorWallet: creator ?? pool ?? mint, // real pump.fun dev when verified
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
  const SCALE_MINT = (process.env.SCALE_TOKEN_MINT || '').trim();
  const minPct = minFeeSharePct();
  const active = await prisma.token.findMany({ where: { isActive: true } });

  for (const token of active) {
    if (token.address === SCALE_MINT || allow.has(token.address)) continue; // exempt
    try {
      const check = await verifyPumpRewardShare(token.address, pool, minPct);
      if (check.status !== 'verified') {
        await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
        console.warn(
          `${PREFIX} ⛔ Deactivated ${token.symbol ?? token.address} — reward share now ${check.status} ` +
          `(${check.walletPct}% to pool)`,
        );
        continue;
      }
      // still paying — also delist if liquidity has fully collapsed
      const info = check.token ?? (await getJupToken(token.address).catch(() => null));
      if (info) {
        const mcap = info.mcap ?? info.fdv ?? 0;
        const liq = info.liquidity ?? 0;
        const graduated = !!info.graduatedPool || !!info.graduatedAt;
        if (determineTier(mcap, liq, graduated) === null) {
          await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
          console.warn(
            `${PREFIX} ⛔ Deactivated ${token.symbol ?? token.address} — liquidity collapsed ($${liq.toFixed(0)})`,
          );
        }
      }
    } catch (err) {
      // chain read hiccup — keep the listing, retry next sweep
      console.warn(`${PREFIX} re-verify failed for ${token.address}:`, err instanceof Error ? err.message : err);
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
