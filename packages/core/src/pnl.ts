// ──────────────────────────────────────────────
// LOADED PROTOCOL — P&L Calculation
// ──────────────────────────────────────────────

import {
  PnLResult,
  BPS,
  PROFIT_SPLIT,
} from './types.js';
import { calculateFlatFee } from './pricing.js';
import type { Tier } from './types.js';

/**
 * Calculate full P&L for a closed position.
 *
 * Profit distribution:
 *   70% of profit → ETH directly to user
 *   30% of profit → auto-buy $FRONT, locked 7 days, then claimable by user
 *
 * The protocol does NOT take a percentage of profit.
 * Protocol revenue comes from flat fees and creator reward inflows only.
 *
 * Loss scenario:
 *   User loses their collateral (up to the full amount).
 *   Protocol capital is returned first — protocol never loses.
 *
 * @param entryPrice - Price at which tokens were bought
 * @param exitPrice - Price at which tokens were sold
 * @param userCapitalWei - User's original collateral
 * @param protocolCapitalWei - Protocol's co-invested capital
 * @param tier - Risk tier (for fee calculation)
 */
export function calculatePnL(
  entryPrice: number,
  exitPrice: number,
  userCapitalWei: bigint,
  protocolCapitalWei: bigint,
  tier: Tier,
): PnLResult {
  const totalCapitalWei = userCapitalWei + protocolCapitalWei;

  // Calculate what the tokens are worth now relative to entry.
  // Use fixed-point BigInt math with 1e18 scaling to avoid Number(bigint) precision loss.
  const PRECISION = 1_000_000_000_000_000_000n; // 1e18 fixed-point scale
  const scaledExitPrice = BigInt(Math.round(exitPrice * 1e18));
  const scaledEntryPrice = BigInt(Math.round(entryPrice * 1e18));
  const totalValueWei =
    (totalCapitalWei * scaledExitPrice) / scaledEntryPrice;

  // Total profit (can be negative)
  const totalProfitWei = totalValueWei - totalCapitalWei;
  const isProfitable = totalProfitWei > 0n;

  // Calculate flat fee (already collected at open, but included in revenue)
  const positionSize = userCapitalWei + protocolCapitalWei;
  const flatFeeWei = calculateFlatFee(positionSize, tier);

  if (!isProfitable) {
    // Loss: user loses their collateral, protocol recovers theirs first.
    // No profit split, no lock. Flat fee was already collected at open.
    return {
      totalValueWei,
      totalProfitWei,
      isProfitable: false,
      userGrossProfitWei: 0n,
      userLockWei: 0n,
      userCashoutWei: 0n,
      protocolProfitShareWei: 0n,
      flatFeeWei,
      totalProtocolRevenueWei: flatFeeWei,
    };
  }

  // Profit split:
  //   70% → user gets as ETH immediately
  //   30% → auto-buy $FRONT & lock for 7 days, user claims after unlock
  const userCashoutWei =
    (totalProfitWei * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
  const userLockWei =
    (totalProfitWei * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

  // Protocol gets no share of the profit — only flat fee
  const protocolProfitShareWei = 0n;
  const totalProtocolRevenueWei = flatFeeWei;

  return {
    totalValueWei,
    totalProfitWei,
    isProfitable: true,
    userGrossProfitWei: totalProfitWei,
    userLockWei,
    userCashoutWei,
    protocolProfitShareWei,
    flatFeeWei,
    totalProtocolRevenueWei,
  };
}

/**
 * Calculate current P&L percentage for a live position.
 */
export function calculateLivePnLPercent(
  entryPrice: number,
  currentPrice: number,
  leverage: number,
): number {
  const priceChangePct = ((currentPrice - entryPrice) / entryPrice) * 100;
  return priceChangePct * leverage;
}

/**
 * Calculate the maximum loss for a position (user's collateral + fee).
 */
export function calculateMaxLoss(
  userCapitalWei: bigint,
  flatFeeWei: bigint,
): bigint {
  return userCapitalWei + flatFeeWei;
}

/**
 * Generate scenario projections for the position preview.
 */
export function generateScenarios(
  userCapitalWei: bigint,
  protocolCapitalWei: bigint,
  tier: Tier,
): {
  if2x: { userCashout: bigint; userLock: bigint };
  if3x: { userCashout: bigint; userLock: bigint };
  ifDump: { maxLoss: bigint };
} {
  const totalCapital = userCapitalWei + protocolCapitalWei;
  const flatFee = calculateFlatFee(totalCapital, tier);

  // 2x scenario
  const profit2x = totalCapital; // doubled = 100% profit
  const cash2x =
    (profit2x * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
  const lock2x =
    (profit2x * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

  // 3x scenario
  const profit3x = totalCapital * 2n; // tripled = 200% profit
  const cash3x =
    (profit3x * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
  const lock3x =
    (profit3x * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

  return {
    if2x: { userCashout: cash2x, userLock: lock2x },
    if3x: { userCashout: cash3x, userLock: lock3x },
    ifDump: { maxLoss: userCapitalWei + flatFee },
  };
}
