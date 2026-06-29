// ──────────────────────────────────────────────
// FRONT PROTOCOL — Revenue Distribution
// ──────────────────────────────────────────────
//
// Protocol revenue comes from FLAT FEES only (not profit sharing).
// The flat fee revenue from trades on a specific coin is split:
//   30% → Creator of that coin (incentivizes devs to list)
//   20% → Buy back & burn $FRONT
//   50% → Capital Pool (grows the lending pool)
//
// Separately, from the user's trade profit:
//   30% of profit → Auto-buy & lock $FRONT for 7 days (given to user)
//   70% of profit → SOL directly to user
//

import {
  RevenueBreakdown,
  FullDistribution,
  PnLResult,
  BPS,
  REVENUE_SPLIT,
} from './types.js';

/**
 * Split protocol revenue (flat fees) into creator / burn / pool portions.
 *
 *   30% → Creator payout
 *   20% → Buy & burn $FRONT
 *   50% → Capital Pool
 */
export function splitRevenue(totalRevenueLamports: bigint): RevenueBreakdown {
  const creatorPayoutLamports =
    (totalRevenueLamports * BigInt(REVENUE_SPLIT.CREATOR)) / BigInt(BPS.FULL);
  const burnAmountLamports =
    (totalRevenueLamports * BigInt(REVENUE_SPLIT.BURN)) / BigInt(BPS.FULL);
  const poolReturnLamports =
    (totalRevenueLamports * BigInt(REVENUE_SPLIT.POOL)) / BigInt(BPS.FULL);

  return {
    totalRevenueLamports,
    creatorPayoutLamports,
    burnAmountLamports,
    poolReturnLamports,
  };
}

/**
 * Calculate the full distribution for a closed position.
 * Combines P&L results with revenue split.
 */
export function calculateFullDistribution(
  pnl: PnLResult,
  userCapitalLamports: bigint,
  protocolCapitalLamports: bigint,
): FullDistribution {
  const revenue = splitRevenue(pnl.totalProtocolRevenueLamports);

  return {
    pnl,
    revenue,
    capitalReturn: {
      userCapitalLamports: pnl.isProfitable ? userCapitalLamports : 0n,
      protocolCapitalLamports: protocolCapitalLamports,
    },
  };
}

/**
 * Format a revenue breakdown for logging / display.
 */
export function formatRevenueBreakdown(revenue: RevenueBreakdown): string {
  const sol = (lamports: bigint) =>
    (Number(lamports) / 1_000_000_000).toFixed(4);

  return [
    `Total Revenue:   ${sol(revenue.totalRevenueLamports)} SOL`,
    `Creator (30%):   ${sol(revenue.creatorPayoutLamports)} SOL`,
    `Burn (20%):      ${sol(revenue.burnAmountLamports)} SOL`,
    `Pool (50%):      ${sol(revenue.poolReturnLamports)} SOL`,
  ].join('\n');
}
