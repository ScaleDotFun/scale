// ──────────────────────────────────────────────
// LOADED PROTOCOL — Token Discovery Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Finds the coins that belong on the terminal and lists them.
//
// There are two sources, and the FIRST one is the one that matters:
//
//   1. THE CHAIN. The fee vault emits a credit event naming the beneficiary and
//      the source curve every time a coin's fees are flushed. Scanning it for
//      our pool wallet enumerates, exactly, every coin paying the protocol.
//      That is the deal a creator signs up for, so it is the definition of a
//      coin that belongs here — and it is unfalsifiable, since the money has
//      already moved.
//
//   2. The trending feed, for coins with real volume that have not redirected
//      yet. Useful, but secondary.
//
// Source 2 used to be the ONLY source, gated behind a $50,000 24h-volume floor.
// So the protocol could only discover a coin that was already popular, and a
// creator who redirected their fees stayed invisible until they got big enough
// to trend. That is exactly backwards: paying the pool is the strongest signal
// available and it was not a signal at all. Two coins paid the pool for hours
// without ever appearing on the site, which is how this was found.
//
// Every candidate still goes through the same gate as a manual listing
// (checkAndListToken → PONS attribution + tier), so discovery cannot list
// anything a human could not.
//
// Other listing paths: POST /tokens/list (API, user-initiated) and the
// listing-scanner's LOADED_VERIFIED_TOKENS allowlist sweep.
//

import { Worker, type Job } from 'bullmq';
import {
  getTrendingTokens,
  isLaunchpadToken,
  tokensCreditingBeneficiary,
  protocolPublicKey,
  getPublicClient,
} from '@loaded/evm';
import { redisConnection, QUEUE_NAMES } from './queues.js';
import { checkAndListToken } from './listing-scanner.js';

const PREFIX = '[token-discovery]';

/** Cap per sweep so one run can't flood the listings table. */
const MAX_NEW_LISTINGS_PER_SWEEP = 10;

/** Minimum 24h volume (USD) before a trending coin is worth listing. */
const MIN_TRENDING_VOLUME_USD = 50_000;

/** Where the credit scan resumes from. */
const CREDIT_CURSOR_KEY = 'discovery:credit-cursor';

/**
 * How far back to look on the very first sweep, when there is no cursor.
 *
 * Blocks are ~4/second here, so this is roughly a day — enough to pick up
 * everyone already paying without scanning the chain from genesis on boot.
 */
const FIRST_RUN_LOOKBACK = 350_000n;

/** Re-read this many blocks behind the cursor, so a reorg cannot lose a payer. */
const CURSOR_OVERLAP = 2_000n;

interface DiscoveryJobData {
  /** empty = full scan */
}

async function processDiscovery(_job: Job<DiscoveryJobData>): Promise<void> {
  const candidates = new Map<string, string>(); // mint → source label

  // ── Source 1: coins that have actually paid us ──
  const pool = protocolPublicKey();
  if (pool) {
    try {
      const head = await getPublicClient().getBlockNumber();
      const saved = await redisConnection.get(CREDIT_CURSOR_KEY);
      const from = saved
        ? (BigInt(saved) > CURSOR_OVERLAP ? BigInt(saved) - CURSOR_OVERLAP : 0n)
        : (head > FIRST_RUN_LOOKBACK ? head - FIRST_RUN_LOOKBACK : 0n);

      const payers = await tokensCreditingBeneficiary(pool, from, head);
      for (const token of payers) candidates.set(token, 'fee-credit');

      // Only advance the cursor after a completed scan. A partial sweep that
      // moved it would skip whatever it missed, permanently.
      await redisConnection.set(CREDIT_CURSOR_KEY, head.toString());
      if (payers.length) {
        console.log(`${PREFIX} ${payers.length} coin(s) crediting the pool between ${from} and ${head}`);
      }
    } catch (err) {
      console.warn(`${PREFIX} credit scan failed:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Source 2: coins with real volume that have not redirected yet ──
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
