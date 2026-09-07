// ──────────────────────────────────────────────
// LOADED PROTOCOL — Post-close job dispatch
// ──────────────────────────────────────────────
//
// A position can be closed from two places: the auto-closer worker
// (TP/SL/liquidation/timeout) and the API route when a user presses SELL.
// Both owe the same downstream work — buy & burn, the user's profit lock,
// the creator payout and the insurance-fund top-up — so that work lives here
// rather than in whichever path happened to implement it. The API route
// previously dispatched none of it, which meant a manual close recorded the
// user's lock without ever buying it and never paid the creator.
//
// Every job carries a deterministic jobId so a retry or a 'finalize' re-run
// cannot pay anything twice.

import { prisma } from '@loaded/database';
import { calculateInsuranceFundTarget, calculateInsuranceDeposit } from '@loaded/core';
import { burnQueue, lockQueue, creatorPayoutsQueue, insuranceFundQueue } from './queues.js';

export interface PostCloseDispatch {
  positionId: number;
  /** 20% of flat-fee revenue — buys and burns $LOADED. */
  burnAmountWei: bigint;
  /** 30% of the user's profit, locked as $LOADED for 7 days. */
  userLockWei: bigint;
  isProfitable: boolean;
  userWallet: string;
  tokenId: number;
  creatorWallet: string | null;
  /** 30% of flat-fee revenue — paid to the coin's creator. */
  creatorPayoutWei: bigint;
  flatFeeWei: bigint;
}

/**
 * Enqueue everything a closed position owes. Never throws: the position is
 * already settled and paid by the time this runs, so a queue hiccup must not
 * turn a completed close into a failed one.
 */
export async function dispatchPostCloseJobs(d: PostCloseDispatch): Promise<void> {
  const { positionId } = d;
  try {
    if (d.burnAmountWei > 0n) {
      await burnQueue.add(
        'burn-from-position',
        { positionId, ethAmountWei: d.burnAmountWei.toString() },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, jobId: `burn-${positionId}` },
      );
    }

    if (d.isProfitable && d.userLockWei > 0n) {
      await lockQueue.add(
        'lock-from-position',
        { userWallet: d.userWallet, ethAmountWei: d.userLockWei.toString(), positionId },
        { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, jobId: `lock-${positionId}` },
      );
    }

    if (d.creatorPayoutWei > 0n && d.creatorWallet) {
      await creatorPayoutsQueue.add(
        'payout-from-position',
        {
          tokenId: d.tokenId,
          creatorWallet: d.creatorWallet,
          amountWei: d.creatorPayoutWei.toString(),
          positionId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `creator-payout-${positionId}` },
      );
    }

    // Size the insurance top-up against real balances so it cannot over-deposit.
    const [insuranceAgg, poolAgg] = await Promise.all([
      prisma.insuranceFund.aggregate({ _sum: { amount: true } }),
      prisma.poolLedger.aggregate({ _sum: { amount: true } }),
    ]);
    const deposit = calculateInsuranceDeposit(
      d.flatFeeWei,
      insuranceAgg._sum.amount ?? 0n,
      calculateInsuranceFundTarget(poolAgg._sum.amount ?? 0n),
    );
    if (deposit > 0n) {
      await insuranceFundQueue.add(
        'deposit-from-position',
        {
          type: 'deposit' as const,
          amountWei: deposit.toString(),
          reason: 'position_close_fee',
          positionId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `insurance-${positionId}` },
      );
    }
  } catch (err) {
    console.error(
      `[post-close] CRITICAL: could not dispatch downstream jobs for position #${positionId} — ` +
      `the close itself is settled; burn/lock/creator-payout need manual replay: ` +
      `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
