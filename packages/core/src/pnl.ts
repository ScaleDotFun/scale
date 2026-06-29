// ──────────────────────────────────────────────
// FRONT PROTOCOL — P&L Calculation
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
 *   70% of profit → SOL directly to user
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
 * @param tokensBought - Number of tokens (in smallest unit)
 * @param userCapitalLamports - User's original collateral
 * @param protocolCapitalLamports - Protocol's co-invested capital
 * @param tier - Risk tier (for fee calculation)
 */
export function calculatePnL(
  entryPrice: number,
  exitPrice: number,
  tokensBought: bigint,
  userCapitalLamports: bigint,
  protocolCapitalLamports: bigint,
  tier: Tier,
): PnLResult {
  const totalCapitalLamports = userCapitalLamports + protocolCapitalLamports;

  // Calculate what the tokens are worth now relative to entry
  const priceRatio = exitPrice / entryPrice;
  const totalValueLamports = BigInt(
    Math.floor(Number(totalCapitalLamports) * priceRatio)
  );

  // Total profit (can be negative)
  const totalProfitLamports = totalValueLamports - totalCapitalLamports;
  const isProfitable = totalProfitLamports > 0n;

  // Calculate flat fee (already collected at open, but included in revenue)
  const positionSize = userCapitalLamports + protocolCapitalLamports;
  const flatFeeLamports = calculateFlatFee(positionSize, tier);

  if (!isProfitable) {
    // Loss: user loses their collateral, protocol recovers theirs first.
    // No profit split, no lock. Flat fee was already collected at open.
    return {
      totalValueLamports,
      totalProfitLamports,
      isProfitable: false,
      userGrossProfitLamports: 0n,
      userLockLamports: 0n,
      userCashoutLamports: 0n,
      protocolProfitShareLamports: 0n,
      flatFeeLamports,
      totalProtocolRevenueLamports: flatFeeLamports,
    };
  }

  // Profit split:
  //   70% → user gets as SOL immediately
  //   30% → auto-buy $FRONT & lock for 7 days, user claims after unlock
  const userCashoutLamports =
    (totalProfitLamports * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
  const userLockLamports =
    (totalProfitLamports * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

  // Protocol gets no share of the profit — only flat fee
  const protocolProfitShareLamports = 0n;
  const totalProtocolRevenueLamports = flatFeeLamports;

  return {
    totalValueLamports,
    totalProfitLamports,
    isProfitable: true,
    userGrossProfitLamports: userCashoutLamports,
    userLockLamports,
    userCashoutLamports,
    protocolProfitShareLamports,
    flatFeeLamports,
    totalProtocolRevenueLamports,
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
  userCapitalLamports: bigint,
  flatFeeLamports: bigint,
): bigint {
  return userCapitalLamports + flatFeeLamports;
}

/**
 * Generate scenario projections for the position preview.
 */
export function generateScenarios(
  userCapitalLamports: bigint,
  protocolCapitalLamports: bigint,
  tier: Tier,
): {
  if2x: { userCashout: bigint; userLock: bigint };
  if3x: { userCashout: bigint; userLock: bigint };
  ifDump: { maxLoss: bigint };
} {
  const totalCapital = userCapitalLamports + protocolCapitalLamports;
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
    ifDump: { maxLoss: userCapitalLamports + flatFee },
  };
}
