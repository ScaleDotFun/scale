// ──────────────────────────────────────────────
// SCALE PROTOCOL — Listing Scanner Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Verifies Noxa creator-fee redirects ON-CHAIN via Noxa's own
// FeeRouter + LaunchFactory (same gate the API /tokens/list uses):
//   • checkAndListToken(mint): lists a token when feeRouting routes
//     ≥ the minimum share to the SCALE pool wallet (or when it's on
//     the SCALE_VERIFIED_TOKENS admin allowlist).
//   • Periodic scan: re-verifies every ACTIVE token and deactivates
//     any whose creator later re-routed fees away from the pool —
//     nobody keeps leverage listings without paying for them.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@scale/database';
import { determineTier } from '@scale/core';
import {
  erc20TotalSupply,
  verifyNoxaFeeRedirect,
  hasEvmProtocolKey,
  getProtocolAccount,
} from '@scale/evm';
import { redisConnection, QUEUE_NAMES } from './queues.js';

const PREFIX = '[listing-scanner]';
const PROTOCOL_WALLET = (process.env.PROTOCOL_WALLET || '').trim();

function poolWalletAddress(): string {
  if (hasEvmProtocolKey()) return getProtocolAccount().address;
  return PROTOCOL_WALLET;
}

const MIN_FEE_SHARE_PCT = Math.min(100, Math.max(1, Number(process.env.SCALE_MIN_FEE_SHARE_PCT) || 51));

function gtBase(): string {
  return (process.env.COINGECKO_API_KEY ?? '').trim()
    ? 'https://pro-api.coingecko.com/api/v3/onchain'
    : 'https://api.geckoterminal.com/api/v2';
}
function gtHeaders(): Record<string, string> {
  const key = (process.env.COINGECKO_API_KEY ?? '').trim();
  return key
    ? { Accept: 'application/json', 'x-cg-pro-api-key': key }
    : { Accept: 'application/json' };
}
const GT_NETWORK = 'robinhood';

/** Manually-verified Noxa fee redirects (comma-separated 0x addresses). */
function verifiedTokens(): string[] {
  return (process.env.SCALE_VERIFIED_TOKENS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[a-f0-9]{40}$/.test(s));
}

interface ListingScanJobData {
  /** When set, only scan a specific token address */
  mint?: string;
}

/**
 * List (or reactivate) a token after verifying its Noxa fee redirect
 * ON-CHAIN — same gate as POST /tokens/list. Metadata from GeckoTerminal.
 */
async function checkAndListToken(mint: string): Promise<boolean> {
  const addr = mint.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    console.warn(`${PREFIX} Skipping ${mint} — not a Robinhood Chain (0x…) address`);
    return false;
  }

  // Real on-chain verification via Noxa's contracts; the env allowlist
  // remains as an admin escape hatch for edge cases.
  let deployer: string | null = null;
  if (!verifiedTokens().includes(addr)) {
    const pool = poolWalletAddress();
    if (!pool) return false;
    try {
      const check = await verifyNoxaFeeRedirect(addr, pool, MIN_FEE_SHARE_PCT);
      if (check.status !== 'verified') {
        console.log(`${PREFIX} ${addr} fee redirect ${check.status} (${check.walletPct}%) — skipping`);
        return false;
      }
      deployer = check.deployer;
    } catch (err) {
      console.warn(`${PREFIX} ${addr} verification read failed:`, err instanceof Error ? err.message : err);
      return false;
    }
  }

  const existing = await prisma.token.findUnique({ where: { address: addr } });
  if (existing) {
    if (!existing.isActive) {
      // verification above already passed — safe to reactivate
      await prisma.token.update({ where: { id: existing.id }, data: { isActive: true } });
      console.log(`${PREFIX} Reactivated ${existing.symbol ?? addr} (fee redirect re-verified)`);
      return true;
    }
    return false; // already listed and active
  }

  // Must be a real ERC-20 on Robinhood Chain
  try {
    await erc20TotalSupply(addr);
  } catch {
    console.warn(`${PREFIX} ${addr} is not readable as an ERC-20 on Robinhood Chain — skipping`);
    return false;
  }

  // Metadata + market data from GeckoTerminal
  let name: string | null = null;
  let symbol: string | null = null;
  let imageUri: string | null = null;
  let marketCapUsd = 0;
  let liquidityUsd = 0;
  try {
    const res = await fetch(`${gtBase()}/networks/${GT_NETWORK}/tokens/${addr}?include=top_pools`, {
      headers: gtHeaders(),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      const a = json.data?.attributes ?? {};
      const pool = (json.included ?? [])[0]?.attributes ?? {};
      name = a.name ?? null;
      symbol = a.symbol ?? null;
      imageUri = a.image_url && a.image_url !== 'missing.png' ? a.image_url : null;
      marketCapUsd = parseFloat(a.market_cap_usd ?? a.fdv_usd ?? '0') || 0;
      liquidityUsd = parseFloat(a.total_reserve_in_usd ?? pool.reserve_in_usd ?? '0') || 0;
    }
  } catch {
    // GT down or token too new — list with defaults
  }

  const tierConfig = determineTier(marketCapUsd, liquidityUsd, liquidityUsd > 0);
  if (!tierConfig) {
    console.warn(`${PREFIX} ${addr} liquidity too low to list safely ($${liquidityUsd.toFixed(0)}) — skipping`);
    return false;
  }

  await prisma.token.create({
    data: {
      address: addr,
      name,
      symbol,
      imageUri,
      creatorWallet: deployer ?? PROTOCOL_WALLET ?? addr, // real Noxa deployer when verified
      tier: tierConfig.tier,
      isActive: true,
      isAutoListed: true,
    },
  });

  console.log(
    `${PREFIX} ✅ Listed ${symbol ?? addr} (tier: ${tierConfig.tier}, liq: $${liquidityUsd.toFixed(0)})`,
  );
  return true;
}

/**
 * Periodic scan:
 *   1. Sweep the admin allowlist for anything not yet listed.
 *   2. RE-VERIFY every active listing's fee redirect on-chain and
 *      deactivate tokens whose creator re-routed fees away.
 */
async function processScan(job: Job<ListingScanJobData>): Promise<void> {
  if (job.data.mint) {
    await checkAndListToken(job.data.mint);
    return;
  }

  // 1. allowlist sweep
  let listed = 0;
  for (const addr of verifiedTokens()) {
    try {
      if (await checkAndListToken(addr)) listed++;
    } catch (err) {
      console.error(`${PREFIX} Error listing ${addr}:`, err instanceof Error ? err.message : err);
    }
  }
  if (listed > 0) console.log(`${PREFIX} Scan complete — ${listed} new listing(s)`);

  // 2. re-verify active listings
  const pool = poolWalletAddress();
  if (!pool) return;
  const allow = new Set(verifiedTokens());
  const SCALE_MINT = (process.env.FRONT_TOKEN_MINT || '').toLowerCase();
  const active = await prisma.token.findMany({ where: { isActive: true } });

  for (const token of active) {
    const addr = token.address.toLowerCase();
    if (addr === SCALE_MINT || allow.has(addr)) continue; // exempt
    try {
      const check = await verifyNoxaFeeRedirect(addr, pool, MIN_FEE_SHARE_PCT);
      if (check.status !== 'verified') {
        await prisma.token.update({ where: { id: token.id }, data: { isActive: false } });
        console.warn(
          `${PREFIX} ⛔ Deactivated ${token.symbol ?? addr} — fee redirect now ${check.status} ` +
          `(${check.walletPct}% to pool, receivers: ${check.receivers.map((r) => `${r.address}:${r.pct}%`).join(',') || 'none'})`,
        );
      }
    } catch (err) {
      // chain read hiccup — keep the listing, retry next sweep
      console.warn(`${PREFIX} re-verify failed for ${addr}:`, err instanceof Error ? err.message : err);
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
