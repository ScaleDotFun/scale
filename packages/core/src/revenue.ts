// ──────────────────────────────────────────────
// LOADED PROTOCOL — Revenue Distribution
// ──────────────────────────────────────────────
//
// Protocol revenue comes from FLAT FEES only (not profit sharing).
// The flat fee revenue from trades on a specific coin is split:
//   30% → Creator of that coin (incentivizes devs to list)
//   20% → Buy back & burn $LOADED
//   50% → Capital Pool (grows the lending pool)
//
// Separately, from the user's trade profit:
//   30% of profit → Auto-buy & lock $LOADED for 7 days (given to user)
//   70% of profit → ETH directly to user
//

import {
  RevenueBreakdown,
  FullDistribution,
  PnLResult,
  BPS,
  REVENUE_SPLIT,
  WEI_PER_ETH,
} from './types.js';

/**
 * Split protocol revenue (flat fees) into creator / burn / pool portions.
 *
 *   30% → Creator payout
 *   20% → Buy & burn $LOADED
 *   50% → Capital Pool
 */
export function splitRevenue(totalRevenueWei: bigint): RevenueBreakdown {
  const creatorPayoutWei =
    (totalRevenueWei * BigInt(REVENUE_SPLIT.CREATOR)) / BigInt(BPS.FULL);
  const burnAmountWei =
    (totalRevenueWei * BigInt(REVENUE_SPLIT.BURN)) / BigInt(BPS.FULL);
  // Pool gets the remainder — absorbs any rounding dust from BigInt floor division
  const poolReturnWei =
    totalRevenueWei - creatorPayoutWei - burnAmountWei;

  return {
    totalRevenueWei,
    creatorPayoutWei,
    burnAmountWei,
    poolReturnWei,
  };
}

/**
 * Calculate the full distribution for a closed position.
 * Combines P&L results with revenue split.
 */
export function calculateFullDistribution(
  pnl: PnLResult,
  userCapitalWei: bigint,
  protocolCapitalWei: bigint,
): FullDistribution {
  const revenue = splitRevenue(pnl.totalProtocolRevenueWei);

  return {
    pnl,
    revenue,
    capitalReturn: {
      userCapitalWei: pnl.isProfitable ? userCapitalWei : 0n,
      protocolCapitalWei: protocolCapitalWei,
    },
  };
}

/**
 * Format a revenue breakdown for logging / display.
 */
export function formatRevenueBreakdown(revenue: RevenueBreakdown): string {
  const eth = (wei: bigint) =>
    (Number(wei) / Number(WEI_PER_ETH)).toFixed(4);

  return [
    `Total Revenue:   ${eth(revenue.totalRevenueWei)} ETH`,
    `Creator (30%):   ${eth(revenue.creatorPayoutWei)} ETH`,
    `Burn (20%):      ${eth(revenue.burnAmountWei)} ETH`,
    `Pool (50%):      ${eth(revenue.poolReturnWei)} ETH`,
  ].join('\n');
}
