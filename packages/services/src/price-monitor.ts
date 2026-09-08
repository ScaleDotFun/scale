// ──────────────────────────────────────────────
// LOADED PROTOCOL — Price Monitor Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Polls all open positions every 10 seconds, checks P&L against exit
// thresholds and 24h timeout, and dispatches position-close jobs.
//

import { randomUUID } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import {
  shouldAutoClose,
  calculateLivePnLPercent,
  type Tier,
} from '@loaded/core';
import {
  transferNative,
  getProtocolAccount,
  hasProtocolKey,
  confirmedTokenDelta,
} from '@loaded/evm';
import { getTokenPricesEth } from './chain-prices.js';
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
 * Enqueue work on the close queue under a deterministic job id.
 *
 * BullMQ's add() is a SILENT no-op when a job with that id already exists in
 * any state — including 'completed' and 'failed', which the queue retains for
 * 24h and 7d respectively. A close that exhausted its three attempts would
 * therefore block every future close for that position: the closer releases
 * the row back to 'open' and the monitor keeps evaluating it, but no job can
 * ever be created again, so liquidation, stop-loss, take-profit and the 24h
 * timeout are all dead for it and the pool rides the coin to zero.
 *
 * Dropping the finished job first restores the intended behaviour: dedupe
 * while a close is genuinely in flight, retry freely once one has settled.
 * Exactly-once is not weakened — it comes from the DB claim
 * (updateMany where status:'open' → 'closing'), not from the job id.
 */
async function enqueueCloseJob(
  jobId: string,
  positionId: number,
  reason: PositionCloseReason,
): Promise<void> {
  try {
    const existing = await positionCloseQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState().catch(() => 'unknown');
      if (state !== 'completed' && state !== 'failed') return; // in flight — dedupe is correct
      await existing.remove();
    }
  } catch (err) {
    // A Redis hiccup here must not stop us from trying to enqueue.
    console.warn(`${PREFIX} could not clear stale job ${jobId}:`, err instanceof Error ? err.message : err);
  }
  await positionCloseQueue.add(
    'close-position',
    { positionId, reason },
    { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, jobId },
  );
}

type PositionCloseReason = 'threshold' | 'timeout' | 'user' | 'take_profit' | 'stop_loss' | 'finalize';

/**
 * Reconciliation sweep — the safety net for every crash window in the
 * open/close state machines. Positions stuck in a transient status past
 * their staleness threshold are finished forward (markers present) or
 * rolled back/refunded (markers absent). Runs on every monitor tick.
 */
export async function reconcileStalePositions(): Promise<void> {
  const now = Date.now();

  // Without the pool key nothing can be finished forward and nothing can be
  // refunded. Running anyway would fall through every recovery branch and
  // write funded rows off as 'failed' — a status no sweep ever revisits — so
  // users would silently lose collateral that is sitting in the pool. Skip the
  // whole sweep instead and stay loud until the key comes back.
  if (!hasProtocolKey()) {
    console.error(
      `${PREFIX} CRITICAL: PROTOCOL_WALLET_PRIVATE_KEY is not set — reconciliation is paused. ` +
      `Stale positions will NOT be recovered or refunded until it is restored.`,
    );
    return;
  }

  // A. Stale 'closing' rows.
  //    - closeTx set: the sell landed but settlement/payout never finished
  //      → enqueue a finalize job (idempotent; resumes from markers).
  //    - closeTx null: the claim was orphaned before any sell landed
  //      → release back to 'open' so monitoring resumes. Wait longer here,
  //      since an in-flight close may legitimately take a couple minutes.
  const staleClosing = await prisma.position.findMany({
    where: {
      status: 'closing',
      OR: [
        { closeTx: { not: null }, statusChangedAt: { lt: new Date(now - 60_000) } },
        { closeTx: null, statusChangedAt: { lt: new Date(now - 300_000) } },
      ],
    },
    select: { id: true, closeTx: true },
  });
  for (const row of staleClosing) {
    if (row.closeTx) {
      console.warn(`${PREFIX} reconcile: #${row.id} stuck in 'closing' with landed sell — enqueueing finalize`);
      await enqueueCloseJob(`finalize-${row.id}-${row.closeTx.slice(0, 8)}`, row.id, 'finalize');
    } else {
      console.warn(`${PREFIX} reconcile: #${row.id} orphaned in 'closing' (no sell landed) — releasing to 'open'`);
      await prisma.position.updateMany({
        where: { id: row.id, status: 'closing' },
        data: { status: 'open', statusChangedAt: new Date() },
      });
    }
  }

  // B. Stale 'opening' rows (>5 min).
  //    - openTx set: the buy landed but settlement never committed
  //      → derive entry data from the transaction itself and open the row.
  //    - collateralTx only: user paid, buy never landed → refund, 'failed'.
  //    - neither: nothing moved → 'failed'.
  const staleOpening = await prisma.position.findMany({
    where: { status: 'opening', statusChangedAt: { lt: new Date(now - 300_000) } },
    include: { token: { select: { address: true } } },
  });
  for (const row of staleOpening) {
    try {
      if (row.openTx) {
        const pool = getProtocolAccount().address;
        // 'unconfirmed' is the API's marker for a swap that verifiably landed
        // (the pool's token balance grew) but whose receipt never confirmed, so
        // there is no hash to re-read. The measured delta was recorded on the
        // row instead — trust it, and never refund a row carrying it: the pool
        // is holding those tokens.
        const tokens =
          row.openTx === 'unconfirmed'
            ? row.tokensBought ?? null
            : await confirmedTokenDelta(row.openTx, pool, row.token.address);
        if (tokens && tokens > 0n) {
          const positionSize = row.userCapital + row.protocolCapital;
          const entryPrice = Number(positionSize) / Number(tokens);
          await prisma.$transaction([
            prisma.position.update({
              where: { id: row.id },
              data: { status: 'open', statusChangedAt: new Date(), entryPrice, tokensBought: tokens },
            }),
            prisma.poolLedger.create({
              data: { type: 'position_open', amount: -row.protocolCapital, referenceId: row.id },
            }),
          ]);
          console.warn(`${PREFIX} reconcile: #${row.id} recovered forward to 'open' (${tokens} tokens @ ${entryPrice})`);
          continue;
        }
        console.error(`${PREFIX} reconcile: #${row.id} has openTx but no token delta found — leaving for next sweep`);
        continue;
      }
      if (row.collateralTx) {
        // Reserve the refund slot before moving anything. transferNative throws
        // on a confirmation timeout as well as on a real failure, and the catch
        // below only logs "will retry next sweep" — without a reservation the
        // next sweep would refund the same collateral a second time out of the
        // pool. Same discipline as the closer's payout: reserve, never release.
        const reservation = `pending:${randomUUID()}`;
        const reserved = await prisma.position.updateMany({
          where: { id: row.id, status: 'opening', userReturnTx: null },
          data: { userReturnTx: reservation },
        });
        if (reserved.count === 0) {
          console.warn(`${PREFIX} reconcile: #${row.id} refund already reserved — skipping`);
          continue;
        }
        let refundSig: string;
        try {
          refundSig = await transferNative(getProtocolAccount(), row.userWallet, row.userCapital);
        } catch (err) {
          console.error(
            `${PREFIX} CRITICAL: refund for #${row.id} left reserved (${reservation}) after failure — ` +
            `verify on-chain whether ${row.userCapital} wei reached ${row.userWallet} before clearing:`,
            err instanceof Error ? err.message : err,
          );
          continue;
        }
        await prisma.position.update({
          where: { id: row.id },
          data: { status: 'failed', statusChangedAt: new Date(), userReturnTx: refundSig },
        });
        console.warn(`${PREFIX} reconcile: #${row.id} refunded ${Number(row.userCapital) / 1e18} ETH to ${row.userWallet} (buy never landed)`);
        continue;
      }
      // Reaching here means both markers are null: the API never got as far as
      // moving the user's collateral, so 'failed' really does mean nothing moved.
      await prisma.position.update({
        where: { id: row.id },
        data: { status: 'failed', statusChangedAt: new Date() },
      });
      console.warn(`${PREFIX} reconcile: #${row.id} marked 'failed' (no marker — no funds moved)`);
    } catch (err) {
      console.error(`${PREFIX} reconcile: #${row.id} recovery attempt failed (will retry next sweep):`, err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Process a price-check job: scan all open positions and evaluate auto-close.
 */
async function processPriceCheckJob(job: Job<PriceCheckJobData>): Promise<void> {
  const startTime = Date.now();

  try {
    // Reconcile crash-window leftovers before evaluating live positions —
    // never let a failure here stop price monitoring.
    if (!job.data.positionId) {
      await reconcileStalePositions().catch((err) =>
        console.error(`${PREFIX} reconcile sweep failed:`, err instanceof Error ? err.message : err),
      );
    }
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

    // Fetch live prices from LI.FI, converted into the same
    // wei-per-raw-unit basis entryPrice is stored in
    const priceMap = await getTokenPricesEth(tokenAddresses);

    // A price feed that returns nothing silently disables take-profit,
    // stop-loss and liquidation for every open position — the monitor keeps
    // running and logs nothing. Say so, loudly, on every blind tick.
    if (priceMap.size === 0) {
      console.error(
        `${PREFIX} CRITICAL: no prices for any of ${tokenAddresses.length} token(s) — ` +
        `TP/SL/liquidation are BLIND for all ${openPositions.length} open position(s) this tick`,
      );
    } else if (priceMap.size < tokenAddresses.length) {
      console.warn(
        `${PREFIX} price feed partial: ${priceMap.size}/${tokenAddresses.length} tokens priced — ` +
        `positions on the rest are unmonitored this tick`,
      );
    }

    let closedCount = 0;
    let warningCount = 0;

    for (const position of openPositions) {
      try {
        const priceData = priceMap.get(position.token.address);
        const currentPrice = priceData?.weiPerRawUnit ?? 0;

        if (!currentPrice || !position.entryPrice) {
          if (!position.entryPrice || !position.tokensBought) {
            // Malformed row: open on-chain exposure with no entry data means
            // TP/SL/liquidation can never fire and a close would sell 0 tokens.
            // Needs manual repair — keep this loud on every sweep.
            console.error(
              `${PREFIX} CRITICAL: position #${position.id} is open but missing entry data ` +
              `(entryPrice=${position.entryPrice}, tokensBought=${position.tokensBought}) — ` +
              `unmonitorable and unclosable until repaired`,
            );
          }
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
            // ONE close job per position, regardless of reason.
            await enqueueCloseJob(`close-${position.id}`, position.id, 'timeout');
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
          // Queue a close job (deduplicated by jobId while one is in flight)
          await enqueueCloseJob(`close-${position.id}`, position.id, result.reason);
          closedCount++;
          console.log(
            `${PREFIX} Position #${position.id} hit ${result.reason} → queued for close (P&L: ${calculateLivePnLPercent(entryPrice, currentPrice, leverage).toFixed(2)}%)`,
          );
          continue;
        }

        // ── User take-profit / stop-loss (price move % vs entry) ──
        const priceMovePct = ((currentPrice / entryPrice) - 1) * 100;
        const tpPct = position.takeProfitPct != null ? Number(position.takeProfitPct) : null;
        const slPct = position.stopLossPct != null ? Number(position.stopLossPct) : null;

        if (tpPct != null && priceMovePct >= tpPct) {
          await enqueueCloseJob(`close-${position.id}`, position.id, 'take_profit');
          closedCount++;
          console.log(
            `${PREFIX} Position #${position.id} hit take-profit (+${priceMovePct.toFixed(2)}% ≥ +${tpPct}%) → queued for close`,
          );
          continue;
        }

        if (slPct != null && priceMovePct <= -slPct) {
          await enqueueCloseJob(`close-${position.id}`, position.id, 'stop_loss');
          closedCount++;
          console.log(
            `${PREFIX} Position #${position.id} hit stop-loss (${priceMovePct.toFixed(2)}% ≤ -${slPct}%) → queued for close`,
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
