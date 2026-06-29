// ──────────────────────────────────────────────
// FRONT PROTOCOL — Price Monitor Worker
// ──────────────────────────────────────────────
//
// Polls all open positions every 10 seconds, checks P&L against exit
// thresholds and 24h timeout, and dispatches position-close jobs.
//

import { Worker, type Job } from 'bullmq';
import { prisma } from '@front-protocol/database';
import {
  shouldAutoClose,
  calculateLivePnLPercent,
  type Tier,
} from '@front-protocol/core';
import { getMultipleTokenPrices } from '@front-protocol/solana';
import {
  redisConnection,
  QUEUE_NAMES,
  priceCheckQueue,
  positionCloseQueue,
} from './queues.js';

const PREFIX = '[price-monitor]';

/** Threshold percentage buffer for "approaching liquidation" warnings */
const WARNING_BUFFER_PCT = 3;

interface PriceCheckJobData {
  /** Optional: only check a specific position */
  positionId?: number;
}

/**
 * Process a price-check job: scan all open positions and evaluate auto-close.
 */
async function processPriceCheckJob(job: Job<PriceCheckJobData>): Promise<void> {
  const startTime = Date.now();

  try {
    // Build query for open positions
    const whereClause = job.data.positionId
      ? { id: job.data.positionId, status: 'open' }
      : { status: 'open' };

    const openPositions = await prisma.position.findMany({
      where: whereClause,
      include: {
        token: {
          select: { address: true, symbol: true },
        },
      },
    });

    if (openPositions.length === 0) {
      return; // Nothing to check — stay quiet to avoid log spam
    }

    // Build a unique set of token addresses and fetch prices in batch
    const addrSet = new Set<string>();
    for (const pos of openPositions) {
      addrSet.add(pos.token.address);
    }
    const tokenAddresses = Array.from(addrSet);

    // Fetch live prices from Jupiter Price API v2
    const priceMap = await getMultipleTokenPrices(tokenAddresses);

    let closedCount = 0;
    let warningCount = 0;

    for (const position of openPositions) {
      try {
        const priceData = priceMap.get(position.token.address);
        const currentPrice = priceData?.priceSol ?? 0;

        if (!currentPrice || !position.entryPrice) {
          // No live price or no entry price recorded — skip price-based checks
          // but still check timeout
          const openedAtMs = position.openedAt.getTime();
          const nowMs = Date.now();

          const timeoutCheck = shouldAutoClose(
            1, // dummy price — only timeout matters when prices are equal
            1,
            Number(position.leverage),
            Number(position.exitThreshold) * 100, // convert % back to bps
            openedAtMs,
            nowMs,
          );

          if (timeoutCheck.shouldClose && timeoutCheck.reason === 'timeout') {
            await positionCloseQueue.add(
              'close-position',
              { positionId: position.id, reason: 'timeout' },
              {
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                jobId: `close-timeout-${position.id}`, // deduplicate
              },
            );
            closedCount++;
            console.log(
              `${PREFIX} Position #${position.id} timed out (24h) → queued for close`,
            );
          }
          continue;
        }

        const entryPrice = Number(position.entryPrice);
        const leverage = Number(position.leverage);
        const exitThresholdBps = Number(position.exitThreshold) * 100; // stored as % (e.g. -15.00), convert to bps (-1500)
        const openedAtMs = position.openedAt.getTime();

        // Check if position should auto-close
        const result = shouldAutoClose(
          entryPrice,
          currentPrice,
          leverage,
          exitThresholdBps,
          openedAtMs,
        );

        if (result.shouldClose && result.reason) {
          // Queue a close job (deduplicated by jobId)
          await positionCloseQueue.add(
            'close-position',
            { positionId: position.id, reason: result.reason },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              jobId: `close-${result.reason}-${position.id}`,
            },
          );
          closedCount++;
          console.log(
            `${PREFIX} Position #${position.id} hit ${result.reason} → queued for close (P&L: ${calculateLivePnLPercent(entryPrice, currentPrice, leverage).toFixed(2)}%)`,
          );
          continue;
        }

        // Check if approaching threshold (within WARNING_BUFFER_PCT)
        const currentPnlPct = calculateLivePnLPercent(entryPrice, currentPrice, leverage);
        const thresholdPct = exitThresholdBps / 100;

        if (currentPnlPct < 0 && currentPnlPct <= thresholdPct + WARNING_BUFFER_PCT) {
          warningCount++;
          console.warn(
            `${PREFIX} ⚠️ Position #${position.id} approaching threshold: ${currentPnlPct.toFixed(2)}% (threshold: ${thresholdPct}%)`,
          );
          // TELEGRAM: would send alert to user via Telegram bot
          // e.g. bot.api.sendMessage(chatId, `⚠️ Your ${symbol} position is at ${pnl}%...`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${PREFIX} Error processing position #${position.id}: ${msg}`);
      }
    }

    const elapsed = Date.now() - startTime;
    if (closedCount > 0 || warningCount > 0) {
      console.log(
        `${PREFIX} Check complete: ${openPositions.length} position(s), ${closedCount} close(s), ${warningCount} warning(s) (${elapsed}ms)`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Fatal error in price check: ${msg}`);
    throw err;
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const priceMonitorWorker = new Worker<PriceCheckJobData>(
  QUEUE_NAMES.PRICE_CHECK,
  processPriceCheckJob,
  {
    connection: redisConnection,
    concurrency: 1, // only one price check at a time
  },
);

priceMonitorWorker.on('completed', (_job) => {
  // Intentionally quiet — runs every 10s, don't spam logs
});

priceMonitorWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

priceMonitorWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});

// ──────────────────────────────────────────────
// Repeatable job setup
// ──────────────────────────────────────────────

/**
 * Schedule price checks to run every 10 seconds as a repeatable job.
 */
export async function schedulePriceMonitor(): Promise<void> {
  // Remove any existing repeatable jobs
  const existing = await priceCheckQueue.getRepeatableJobs();
  for (const job of existing) {
    await priceCheckQueue.removeRepeatableByKey(job.key);
  }

  await priceCheckQueue.add(
    'check-all-prices',
    {},
    {
      repeat: { every: 10_000 }, // 10 seconds
      attempts: 1, // don't retry — next tick will run in 10s anyway
      removeOnComplete: { count: 10 }, // keep minimal history
      removeOnFail: { count: 50 },
    },
  );

  console.log(`${PREFIX} Scheduled price checks every 10 seconds`);
}
