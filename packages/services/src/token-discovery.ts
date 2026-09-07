// ──────────────────────────────────────────────
// LOADED PROTOCOL — Token Discovery Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Auto-lists tradeable launchpad memecoins so the terminal is never empty.
// Every 10 minutes it pulls the live trending feed for Robinhood Chain and
// keeps the coins that clear a 24h volume floor.
// Each candidate goes through the exact same gate as a manual listing
// (checkAndListToken → PONS attribution + tier/liquidity floor),
// so discovery can't list anything a human couldn't.
//
// Other listing paths: POST /tokens/list (API, user-initiated) and the
// listing-scanner's LOADED_VERIFIED_TOKENS allowlist sweep.
//

import { Worker, type Job } from 'bullmq';
import { getTrendingTokens, isLaunchpadToken } from '@loaded/evm';
import { redisConnection, QUEUE_NAMES } from './queues.js';
import { checkAndListToken } from './listing-scanner.js';

const PREFIX = '[token-discovery]';

/** Cap per sweep so one run can't flood the listings table. */
const MAX_NEW_LISTINGS_PER_SWEEP = 10;

/** Minimum 24h volume (USD) before a trending coin is worth listing. */
const MIN_TRENDING_VOLUME_USD = 50_000;

interface DiscoveryJobData {
  /** empty = full scan */
}

async function processDiscovery(_job: Job<DiscoveryJobData>): Promise<void> {
  const candidates = new Map<string, string>(); // mint → source label

  try {
    const trending = await getTrendingTokens(50);
    for (const t of trending) {
      if (!isLaunchpadToken(t.address, t.launchpad)) continue; // launchpad coins only
      if ((t.volume24h ?? 0) >= MIN_TRENDING_VOLUME_USD) candidates.set(t.address, 'trending');
    }
  } catch (err) {
    console.warn(`${PREFIX} trending feed failed:`, err instanceof Error ? err.message : err);
  }

  if (candidates.size === 0) return;

  let listed = 0;
  for (const [mint, source] of candidates) {
    if (listed >= MAX_NEW_LISTINGS_PER_SWEEP) break;
    try {
      if (await checkAndListToken(mint)) {
        listed++;
        console.log(`${PREFIX} 🔎 Auto-listed ${mint} (source: ${source})`);
      }
    } catch (err) {
      console.warn(`${PREFIX} candidate ${mint} failed:`, err instanceof Error ? err.message : err);
    }
  }

  if (listed > 0) {
    console.log(`${PREFIX} Discovery sweep complete — ${listed} new listing(s) from ${candidates.size} candidates`);
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const tokenDiscoveryWorker = new Worker<DiscoveryJobData>(
  QUEUE_NAMES.TOKEN_DISCOVERY,
  processDiscovery,
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

tokenDiscoveryWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

tokenDiscoveryWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});
