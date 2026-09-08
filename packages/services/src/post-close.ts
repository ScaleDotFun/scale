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
  /** How much of the pool's own capital the sale failed to return, if any. */
  poolShortfallWei?: bigint;
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

    // Draw on the insurance fund when the pool did not get its capital back.
    // This is the only producer of a 'withdrawal': the fund used to be
    // write-only, accumulating against a promise ("the protocol should NEVER
    // lose money") that no code path could keep. The fund is a ledger against
    // the same wallet, so this books the loss where it belongs rather than
    // leaving it silently absorbed by the pool.
    if (d.poolShortfallWei && d.poolShortfallWei > 0n) {
      await insuranceFundQueue.add(
        'cover-shortfall',
        {
          type: 'withdrawal' as const,
          amountWei: d.poolShortfallWei.toString(),
          reason: 'slippage_coverage',
          positionId,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, jobId: `insurance-cover-${positionId}` },
      );
    }

    // Enqueue the RAW flat fee. The worker is the single authority on sizing:
    // it applies INSURANCE_DEPOSIT_RATE_BPS itself and clamps to what the fund
    // still needs. Pre-computing the deposit here and sending that meant the
    // rate was applied twice — 10% of 10% — so the fund accrued at a tenth of
    // its designed rate and would have topped out at 0.2% of the pool instead
    // of 2%. Cheap to get wrong, invisible until the fund is actually needed.
    //
    // We still check whether anything is owed before queueing, to avoid a job
    // per close once the fund is at target.
    const [insuranceAgg, poolAgg] = await Promise.all([
      prisma.insuranceFund.aggregate({ _sum: { amount: true } }),
      prisma.poolLedger.aggregate({ _sum: { amount: true } }),
    ]);
    const wouldDeposit = calculateInsuranceDeposit(
      d.flatFeeWei,
      insuranceAgg._sum.amount ?? 0n,
      calculateInsuranceFundTarget(poolAgg._sum.amount ?? 0n),
    );
    if (wouldDeposit > 0n) {
      await insuranceFundQueue.add(
        'deposit-from-position',
        {
          type: 'deposit' as const,
          amountWei: d.flatFeeWei.toString(),
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
