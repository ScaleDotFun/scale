// ──────────────────────────────────────────────
// FRONT PROTOCOL — Shared Queue Definitions & Redis
// ──────────────────────────────────────────────

import { Queue, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

// ──────────────────────────────────────────────
// Queue name constants
// ──────────────────────────────────────────────

export const QUEUE_NAMES = {
  FEE_CLAIMS: 'fee-claims',
  POSITION_CLOSE: 'position-close',
  BURN_QUEUE: 'burn-queue',
  LOCK_QUEUE: 'lock-queue',
  CREATOR_PAYOUTS: 'creator-payouts',
  PRICE_CHECK: 'price-check',
  LISTING_SCAN: 'listing-scan',
  INSURANCE_FUND: 'insurance-fund',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// ──────────────────────────────────────────────
// Redis connection (shared by all queues/workers)
// ──────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

/** Shared Redis connection for BullMQ. Must use noeviction maxmemory-policy. */
export const redisConnection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redisConnection.on('error', (err) => {
  console.error('[redis] Connection error:', err.message);
});

redisConnection.on('connect', () => {
  console.log('[redis] Connected to', REDIS_URL);
});

// ──────────────────────────────────────────────
// Queue instances
// ──────────────────────────────────────────────

const defaultQueueOpts = {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 1000, age: 24 * 3600 },
    removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
  },
};

export const feeClaimsQueue = new Queue(QUEUE_NAMES.FEE_CLAIMS, defaultQueueOpts);
export const positionCloseQueue = new Queue(QUEUE_NAMES.POSITION_CLOSE, defaultQueueOpts);
export const burnQueue = new Queue(QUEUE_NAMES.BURN_QUEUE, defaultQueueOpts);
export const lockQueue = new Queue(QUEUE_NAMES.LOCK_QUEUE, defaultQueueOpts);
export const creatorPayoutsQueue = new Queue(QUEUE_NAMES.CREATOR_PAYOUTS, defaultQueueOpts);
export const priceCheckQueue = new Queue(QUEUE_NAMES.PRICE_CHECK, defaultQueueOpts);
export const listingScanQueue = new Queue(QUEUE_NAMES.LISTING_SCAN, defaultQueueOpts);
export const insuranceFundQueue = new Queue(QUEUE_NAMES.INSURANCE_FUND, defaultQueueOpts);

/** Map of queue name → Queue instance for dynamic access */
const queueMap: Record<QueueName, Queue> = {
  [QUEUE_NAMES.FEE_CLAIMS]: feeClaimsQueue,
  [QUEUE_NAMES.POSITION_CLOSE]: positionCloseQueue,
  [QUEUE_NAMES.BURN_QUEUE]: burnQueue,
  [QUEUE_NAMES.LOCK_QUEUE]: lockQueue,
  [QUEUE_NAMES.CREATOR_PAYOUTS]: creatorPayoutsQueue,
  [QUEUE_NAMES.PRICE_CHECK]: priceCheckQueue,
  [QUEUE_NAMES.LISTING_SCAN]: listingScanQueue,
  [QUEUE_NAMES.INSURANCE_FUND]: insuranceFundQueue,
};

/** All queue instances for iteration (e.g. shutdown) */
export const allQueues: Queue[] = Object.values(queueMap);

// ──────────────────────────────────────────────
// Helper: add a job to any queue by name
// ──────────────────────────────────────────────

/**
 * Add a job to the specified queue.
 *
 * @param queueName - One of the QUEUE_NAMES constants
 * @param jobName - Descriptive job name (for logging / dashboard)
 * @param data - Job payload
 * @param opts - Optional BullMQ job options (delay, repeat, priority, etc.)
 */
export async function addJob<T extends Record<string, unknown>>(
  queueName: QueueName,
  jobName: string,
  data: T,
  opts?: JobsOptions,
): Promise<void> {
  const queue = queueMap[queueName];
  if (!queue) {
    throw new Error(`[queues] Unknown queue: ${queueName}`);
  }
  await queue.add(jobName, data, opts);
}
