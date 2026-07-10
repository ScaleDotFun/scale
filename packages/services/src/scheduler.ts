// ──────────────────────────────────────────────
// FRONT PROTOCOL — Service Scheduler (Main Entry Point)
// ──────────────────────────────────────────────
//
// Boots all BullMQ workers and schedules recurring jobs.
// Run with: pnpm --filter @scale/services dev
//

import './sentry.js'; // must init before anything else
import 'dotenv/config';
import type { Worker } from 'bullmq';
import { redisConnection, allQueues, listingScanQueue, tokenDiscoveryQueue } from './queues.js';
import { feeClaimerWorker, scheduleFeeClaimer } from './fee-claimer.js';
import { priceMonitorWorker, schedulePriceMonitor } from './price-monitor.js';
import { positionCloserWorker } from './position-closer.js';
import { burnEngineWorker } from './burn-engine.js';
import { lockEngineWorker, scheduleLockUnlockChecker } from './lock-engine.js';
import { creatorPayoutWorker } from './creator-payout.js';
import { listingScannerWorker } from './listing-scanner.js';
import { insuranceFundWorker } from './insurance-fund.js';
import { tokenDiscoveryWorker } from './token-discovery.js';

const PREFIX = '[scheduler]';

// ──────────────────────────────────────────────
// All workers in one place for lifecycle management
// ──────────────────────────────────────────────

const allWorkers: { name: string; worker: Worker }[] = [
  { name: 'fee-claimer', worker: feeClaimerWorker },
  { name: 'price-monitor', worker: priceMonitorWorker },
  { name: 'position-closer', worker: positionCloserWorker },
  { name: 'burn-engine', worker: burnEngineWorker },
  { name: 'lock-engine', worker: lockEngineWorker },
  { name: 'creator-payout', worker: creatorPayoutWorker },
  { name: 'listing-scanner', worker: listingScannerWorker },
  { name: 'insurance-fund', worker: insuranceFundWorker },
  { name: 'token-discovery', worker: tokenDiscoveryWorker },
];

// ──────────────────────────────────────────────
// Graceful shutdown
// ──────────────────────────────────────────────

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n${PREFIX} Received ${signal}, starting graceful shutdown...`);

  // Close all workers (waits for active jobs to finish)
  const workerClosePromises = allWorkers.map(async ({ name, worker }) => {
    try {
      console.log(`${PREFIX} Closing worker: ${name}`);
      await worker.close();
      console.log(`${PREFIX} Worker closed: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${PREFIX} Error closing worker ${name}: ${msg}`);
    }
  });

  await Promise.allSettled(workerClosePromises);

  // Close all queues
  const queueClosePromises = allQueues.map(async (queue) => {
    try {
      await queue.close();
    } catch {
      // Ignore queue close errors during shutdown
    }
  });

  await Promise.allSettled(queueClosePromises);

  // Disconnect Redis
  try {
    await redisConnection.quit();
    console.log(`${PREFIX} Redis connection closed`);
  } catch {
    // Force disconnect if quit fails
    redisConnection.disconnect();
  }

  console.log(`${PREFIX} Shutdown complete`);
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error(`${PREFIX} Uncaught exception:`, err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error(`${PREFIX} Unhandled rejection:`, reason);
});

// ──────────────────────────────────────────────
// Boot sequence
// ──────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`${PREFIX} ──────────────────────────────────────`);
  console.log(`${PREFIX}   FRONT PROTOCOL — Background Services`);
  console.log(`${PREFIX} ──────────────────────────────────────`);

  const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  console.log(`${PREFIX} Redis: ${redisUrl}`);
  console.log(`${PREFIX} Environment: ${process.env.NODE_ENV ?? 'development'}`);

  // Wait for Redis connection
  try {
    await redisConnection.ping();
    console.log(`${PREFIX} Redis connection verified ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Failed to connect to Redis: ${msg}`);
    console.error(`${PREFIX} Make sure Redis is running and REDIS_URL is correct`);
    process.exit(1);
  }

  // Log worker status
  console.log(`${PREFIX} Starting ${allWorkers.length} worker(s):`);
  for (const { name } of allWorkers) {
    console.log(`${PREFIX}   • ${name}`);
  }

  // Schedule recurring jobs
  try {
    await scheduleFeeClaimer();
    await schedulePriceMonitor();
    await scheduleLockUnlockChecker();

    // Schedule listing scanner every 5 minutes
    const existingScans = await listingScanQueue.getRepeatableJobs();
    for (const j of existingScans) {
      await listingScanQueue.removeRepeatableByKey(j.key);
    }
    await listingScanQueue.add('scan-listings', {}, {
      repeat: { every: 5 * 60 * 1000 },
      attempts: 1,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    });

    // Schedule token discovery every 10 minutes
    const existingDiscovery = await tokenDiscoveryQueue.getRepeatableJobs();
    for (const j of existingDiscovery) {
      await tokenDiscoveryQueue.removeRepeatableByKey(j.key);
    }
    await tokenDiscoveryQueue.add('discover-tokens', {}, {
      repeat: { every: 10 * 60 * 1000 },
      attempts: 1,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    });

    console.log(`${PREFIX} Recurring jobs scheduled ✓`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Failed to schedule recurring jobs: ${msg}`);
    process.exit(1);
  }

  console.log(`${PREFIX} ──────────────────────────────────────`);
  console.log(`${PREFIX}   All services running. Press Ctrl+C to stop.`);
  console.log(`${PREFIX} ──────────────────────────────────────`);
}

main().catch((err) => {
  console.error(`${PREFIX} Fatal startup error:`, err);
  process.exit(1);
});
