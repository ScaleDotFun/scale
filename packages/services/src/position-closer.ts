// ──────────────────────────────────────────────
// LOADED PROTOCOL — Position Closer Worker (Robinhood Chain)
// ──────────────────────────────────────────────
//
// Processes position close jobs: calculates final P&L, distributes revenue,
// updates the position record, and dispatches downstream jobs (burn, lock, payout).
//

import { randomUUID } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { prisma } from '@loaded/database';
import { dispatchPostCloseJobs } from './post-close.js';
import {
  calculatePnL,
  splitRevenue,
  calculateInsuranceDeposit,
  calculateInsuranceFundTarget,
  type Tier,
  type PositionStatus,
} from '@loaded/core';
import {
  swapTokenForNative,
  getProtocolAccount,
  hasProtocolKey,
  transferNative,
  confirmedNativeDelta,
} from '@loaded/evm';
import {
  redisConnection,
  QUEUE_NAMES,
  burnQueue,
  lockQueue,
  creatorPayoutsQueue,
  insuranceFundQueue,
} from './queues.js';

const PREFIX = '[position-closer]';

interface PositionCloseJobData {
  positionId: number;
  reason: 'threshold' | 'timeout' | 'user' | 'take_profit' | 'stop_loss' | 'finalize';
}

/**
 * Persist a small recovery marker with retries. Markers are what make a
 * crash at any point recoverable — losing one silently would reopen the
 * double-sell/double-payout window, so exhaust retries before giving up.
 */
async function persistWithRetry(fn: () => Promise<unknown>, label: string, attempts = 5): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      await fn();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  console.error(`${PREFIX} CRITICAL: failed to persist ${label} after ${attempts} attempts`);
  return false;
}

/**
 * Determine final position status based on P&L and close reason.
 */
function determineStatus(
  isProfitable: boolean,
  reason: PositionCloseJobData['reason'],
): PositionStatus {
  if (reason === 'timeout') return 'timed_out';
  if (reason === 'threshold' && !isProfitable) return 'liquidated';
  return isProfitable ? 'closed_profit' : 'closed_loss';
}

/**
 * Sell tokens back to ETH via LI.FI.
 * amountOutMinimum comes from the LI.FI quote (3% slippage for
 * liquidation sells); the pool itself is the last line of defense.
 */
async function executeTokenSell(
  tokenAddress: string,
  tokensBought: bigint,
): Promise<{ ethReceived: bigint; txHash: string }> {
  if (!hasProtocolKey()) {
    throw new Error('Robinhood Chain protocol pool wallet is not configured — cannot sell');
  }
  const protocolAccount = getProtocolAccount();

  console.log(
    `${PREFIX} Selling ${tokensBought} tokens of ${tokenAddress} via LI.FI`,
  );

  const result = await swapTokenForNative(
    protocolAccount,
    tokenAddress,
    tokensBought,
    300, // 3% slippage (bps)
  );

  console.log(
    `${PREFIX} Sell complete: received ${result.amountOut} wei, tx=${result.txHash}`,
  );

  return {
    ethReceived: result.amountOut,
    txHash: result.txHash,
  };
}

/**
 * Process a position close job.
 *
 * Profit distribution:
 *   70% of profit → ETH directly to user
 *   30% of profit → auto-buy $LOADED, locked 7 days, claimable by user
 *
 * Protocol revenue = flat fee only (split: 30% creator, 20% burn, 50% pool)
 */
async function processPositionClose(job: Job<PositionCloseJobData>): Promise<void> {
  const { positionId, reason } = job.data;
  const startTime = Date.now();
  console.log(`${PREFIX} Closing position #${positionId} (reason: ${reason})`);

  try {
    // ── Atomic claim ─────────────────────────────────
    // Flip open → closing BEFORE any on-chain action, exactly like the API
    // route does: this is what prevents the user's SELL and a concurrent
    // auto-close job from both selling the same position. 'finalize' jobs
    // (from the recovery sweep) instead resume rows already stuck in
    // 'closing' whose sell already landed (closeTx persisted).
    if (reason === 'finalize') {
      const row = await prisma.position.findUnique({ where: { id: positionId }, select: { status: true, closeTx: true } });
      if (!row || row.status !== 'closing' || !row.closeTx) {
        console.warn(`${PREFIX} finalize #${positionId}: nothing to finalize (status=${row?.status}, closeTx=${row?.closeTx ? 'set' : 'null'})`);
        return;
      }
    } else {
      const claimed = await prisma.position.updateMany({
        where: { id: positionId, status: 'open' },
        data: { status: 'closing', statusChangedAt: new Date() },
      });
      if (claimed.count === 0) {
        console.warn(`${PREFIX} Position #${positionId} not claimable (already closing/closed), skipping`);
        return;
      }
    }

    // Load position with token data
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: {
        token: {
          select: { id: true, address: true, symbol: true, creatorWallet: true, totalTradingVolume: true },
        },
      },
    });

    if (!position) {
      console.error(`${PREFIX} Position #${positionId} not found`);
      return;
    }

    if (!position.entryPrice || !position.tokensBought) {
      // Blind row — unclosable. Release the claim so it stays visible to
      // monitoring/repair rather than freezing in 'closing'.
      console.error(`${PREFIX} CRITICAL: position #${positionId} missing entry data — releasing claim, needs repair`);
      await prisma.position.updateMany({
        where: { id: positionId, status: 'closing' },
        data: { status: 'open', statusChangedAt: new Date() },
      });
      return;
    }

    const entryPrice = Number(position.entryPrice);
    const tokensBought = position.tokensBought;
    const userCapitalWei = position.userCapital;
    const protocolCapitalWei = position.protocolCapital;
    const tier = position.tier as Tier;

    // ── Sell (idempotent) ────────────────────────────
    // If closeTx is already persisted, the sell landed on a previous attempt
    // that died before settling — NEVER sell again; resume from the marker.
    let ethReceived: bigint;
    let closeTx: string;
    if (position.closeTx) {
      closeTx = position.closeTx;
      ethReceived = position.ethReceived ?? 0n;
      if (ethReceived <= 0n) {
        const delta = await confirmedNativeDelta(closeTx, getProtocolAccount().address);
        if (!delta || delta <= 0n) {
          console.error(`${PREFIX} CRITICAL: #${positionId} has closeTx ${closeTx.slice(0, 16)}… but proceeds unrecoverable — manual review required`);
          return;
        }
        ethReceived = delta;
      }
      console.log(`${PREFIX} #${positionId} resuming from persisted sell ${closeTx.slice(0, 16)}… (${ethReceived} wei)`);
    } else {
      try {
        const sale = await executeTokenSell(position.token.address, tokensBought);
        ethReceived = sale.ethReceived;
        closeTx = sale.txHash;
      } catch (sellErr) {
        // Sell conclusively did not land (the EVM layer now verifies via
        // status polling) — release the claim so monitoring resumes, then
        // rethrow for a BullMQ retry that will re-claim.
        await prisma.position.updateMany({
          where: { id: positionId, status: 'closing' },
          data: { status: 'open', statusChangedAt: new Date() },
        });
        throw sellErr;
      }
      // Marker: the sell is now irreversible — persist it before anything else.
      await persistWithRetry(
        () => prisma.position.update({ where: { id: positionId }, data: { closeTx, ethReceived } }),
        `closeTx marker for #${positionId}`,
      );
    }

    // Calculate exit price from actual swap result
    const exitPrice = Number(ethReceived) / Number(tokensBought);
    const flatFeeWei = position.flatFee;

    // Use core PnL calculation
    const pnl = calculatePnL(
      entryPrice,
      exitPrice,
      userCapitalWei,
      protocolCapitalWei,
      tier,
    );
    const isProfitable = pnl.isProfitable;
    const totalProfitWei = pnl.totalProfitWei;
    const userCashProfitWei = pnl.userCashoutWei;
    const userLockWei = pnl.userLockWei;

    // Use core revenue split
    const revenue = splitRevenue(flatFeeWei);
    const creatorPayoutWei = revenue.creatorPayoutWei;
    const burnAmountWei = revenue.burnAmountWei;
    const poolReturnWei = revenue.poolReturnWei;

    // What goes back to user
    const userReturnWei = isProfitable
      ? userCapitalWei + userCashProfitWei - flatFeeWei
      : (ethReceived > protocolCapitalWei + flatFeeWei
          ? ethReceived - protocolCapitalWei - flatFeeWei
          : 0n);

    // What the pool actually got back out of the sale, against what it put in.
    const poolRecoveredWei = ethReceived - userReturnWei;
    const poolShortfallWei =
      poolRecoveredWei < protocolCapitalWei ? protocolCapitalWei - poolRecoveredWei : 0n;

    // Determine final status
    const finalStatus = determineStatus(isProfitable, reason);

    // ── Payout (exactly-once) ────────────────────────
    // Reading userReturnTx and then acting on it is not enough: the recovery
    // sweep can enqueue a 'finalize' while the original close is merely slow,
    // and both would read null and both pay from pool funds. Reserve the payout
    // slot with a conditional update instead — only the worker whose update
    // affects a row is allowed to move money.
    if (userReturnWei > 0n && !position.userReturnTx) {
      const reservation = `pending:${randomUUID()}`;
      const reserved = await prisma.position.updateMany({
        where: { id: positionId, userReturnTx: null },
        data: { userReturnTx: reservation },
      });
      if (reserved.count === 0) {
        console.warn(`${PREFIX} #${positionId}: payout already reserved by another worker, skipping transfer`);
      } else {
        try {
          const protocolAccount = getProtocolAccount();
          const returnSig = await transferNative(protocolAccount, position.userWallet, userReturnWei);
          await persistWithRetry(
            () => prisma.position.update({ where: { id: positionId }, data: { userReturnTx: returnSig } }),
            `userReturnTx marker for #${positionId}`,
          );
          console.log(`${PREFIX} Returned ${Number(userReturnWei) / 1e18} ETH to user ${position.userWallet}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Deliberately do NOT release the reservation. transferNative throws
          // on a confirmation timeout as well as on a real failure, and in the
          // timeout case the transfer can still land — releasing would let a
          // retry pay a second time. A payout stuck pending is recoverable by
          // hand; a double payout out of the pool is not.
          console.error(
            `${PREFIX} CRITICAL: payout for #${positionId} left reserved (${reservation}) after failure — ` +
            `verify on-chain whether ${userReturnWei} wei reached ${position.userWallet} before clearing: ${msg}`,
          );
          // Do NOT release the close claim — the sell already landed (closeTx
          // marker is set), so the retry must resume forward, never re-sell.
          throw err;
        }
      }
    }

    // Persist everything in a transaction
    await prisma.$transaction([
      prisma.position.update({
        where: { id: positionId },
        data: {
          status: finalStatus,
          statusChangedAt: new Date(),
          exitPrice: exitPrice,
          pnlEth: totalProfitWei,
          userProfit: pnl.userCashoutWei + pnl.userLockWei,
          protocolRevenue: pnl.totalProtocolRevenueWei,
          creatorPayout: creatorPayoutWei,
          burnAmount: burnAmountWei,
          poolReturn: poolReturnWei,
          lockAmount: userLockWei,
          closedAt: new Date(),
          closeTx,
        },
      }),

      // Pool ledger: credit what the wallet ACTUALLY retained from the sale.
      // Crediting only the pool's 50% slice of the fee understated it: the
      // creator's 30% and the burn's 20% never left at this moment, but both
      // are debited later (burn-engine and the creator claim), so the ledger
      // lost the protocol's entire retained fee revenue on every position.
      // proceeds minus the user's payout is the exact delta, on wins and on
      // losses where the pool did not recover in full.
      prisma.poolLedger.create({
        data: {
          type: 'position_close',
          amount: ethReceived - userReturnWei,
          referenceId: positionId,
          txHash: closeTx,
        },
      }),

      // Atomic increment — the worker runs with concurrency 5 and this used to
      // be a read-modify-write off a value read outside the transaction, so
      // simultaneous closes on the same coin overwrote each other's volume.
      prisma.token.update({
        where: { id: position.token.id },
        data: {
          totalTradingVolume: { increment: userCapitalWei + protocolCapitalWei },
        },
      }),
    ]);

    // Dispatch downstream jobs — shared with the API close path so a manual
    // SELL owes exactly the same burn / lock / creator-payout / insurance work.
    await dispatchPostCloseJobs({
      positionId,
      burnAmountWei,
      userLockWei,
      isProfitable,
      userWallet: position.userWallet,
      tokenId: position.token.id,
      creatorWallet: position.token.creatorWallet,
      creatorPayoutWei,
      flatFeeWei,
      poolShortfallWei,
    });

    const elapsed = Date.now() - startTime;
    console.log(
      `${PREFIX} Position #${positionId} closed as ${finalStatus} | ` +
        `P&L: ${(Number(totalProfitWei) / 1e18).toFixed(4)} ETH | ` +
        `Revenue: ${(Number(flatFeeWei) / 1e18).toFixed(4)} ETH | ` +
        `(${elapsed}ms)`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${PREFIX} Error closing position #${positionId}: ${msg}`);
    throw err; // Let BullMQ handle retry
  }
}

// ──────────────────────────────────────────────
// Worker
// ──────────────────────────────────────────────

export const positionCloserWorker = new Worker<PositionCloseJobData>(
  QUEUE_NAMES.POSITION_CLOSE,
  processPositionClose,
  {
    connection: redisConnection,
    concurrency: 5, // can process multiple closes concurrently
  },
);

positionCloserWorker.on('completed', (job) => {
  console.log(`${PREFIX} Job ${job.id} completed (position #${job.data.positionId})`);
});

positionCloserWorker.on('failed', (job, err) => {
  console.error(`${PREFIX} Job ${job?.id} failed: ${err.message}`);
});

positionCloserWorker.on('error', (err) => {
  console.error(`${PREFIX} Worker error: ${err.message}`);
});


