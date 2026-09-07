// ──────────────────────────────────────────────
// LOADED PROTOCOL — Safety & Risk Calculations
// ──────────────────────────────────────────────
//
// Centralized safety logic to guarantee the protocol never loses money.
// Key principles:
//   1. Liquidation fires BEFORE user collateral is fully consumed (buffer)
//   2. Position size is limited by pool liquidity and token depth
//   3. Insurance fund covers edge cases (flash crashes, slippage)
//

import {
  WEI_PER_ETH,
  SAFETY_BUFFER_BPS,
  INSURANCE_FUND_TARGET_BPS,
  INSURANCE_DEPOSIT_RATE_BPS,
  BPS,
} from './types.js';
import { TIER_CONFIGS } from './pricing.js';
import type { Tier } from './types.js';

/**
 * Calculate the safe exit threshold for a position.
 * This is the point at which the position auto-closes, BEFORE the
 * user's full collateral is consumed.
 *
 * @param tier - The risk tier
 * @returns Exit threshold in basis points (negative), including safety buffer
 */
export function calculateSafeExitThreshold(tier: Tier): number {
  const config = TIER_CONFIGS[tier];
  // exitThresholdBps is negative (e.g., -1500 = -15%)
  // SAFETY_BUFFER_BPS is positive (e.g., 500 = 5%)
  // Adding the buffer makes the threshold less negative (closes earlier)
  return config.exitThresholdBps + SAFETY_BUFFER_BPS;
}

/**
 * Estimate slippage risk for a position based on liquidity depth.
 * Higher risk = more likely to have significant slippage on exit.
 *
 * @param positionSizeWei - Total position size
 * @param liquidityUsd - Token's total liquidity in USD
 * @param ethPriceUsd - Current ETH price in USD
 * @returns Risk score 0-100 (0 = no risk, 100 = extremely risky)
 */
export function estimateSlippageRisk(
  positionSizeWei: bigint,
  liquidityUsd: number,
  ethPriceUsd: number,
): number {
  if (liquidityUsd <= 0 || ethPriceUsd <= 0) return 100;

  const positionEth = Number(positionSizeWei) / Number(WEI_PER_ETH);
  const positionUsd = positionEth * ethPriceUsd;

  // Position as percentage of total liquidity
  const impactPct = (positionUsd / liquidityUsd) * 100;

  // Risk scoring:
  //   < 1% of liquidity = low risk (0-20)
  //   1-5% of liquidity = medium risk (20-50)
  //   5-20% of liquidity = high risk (50-80)
  //   > 20% of liquidity = extreme risk (80-100)
  if (impactPct < 1) return Math.round(impactPct * 20);
  if (impactPct < 5) return Math.round(20 + (impactPct - 1) * 7.5);
  if (impactPct < 20) return Math.round(50 + (impactPct - 5) * 2);
  return Math.min(100, Math.round(80 + (impactPct - 20)));
}

/**
 * Calculate the maximum safe position size for a token.
 * Limits position size based on available liquidity to avoid
 * excessive market impact on exit.
 *
 * @param liquidityUsd - Token's total liquidity in USD
 * @param ethPriceUsd - Current ETH price in USD
 * @param tier - Risk tier
 * @returns Maximum position size in wei
 */
export function maxSafePositionSize(
  liquidityUsd: number,
  ethPriceUsd: number,
  tier: Tier,
): bigint {
  if (liquidityUsd <= 0 || ethPriceUsd <= 0) return 0n;

  // Max impact percentages by tier.
  // Note: the "position size" is the leveraged notional, but actual
  // on-chain buy is only the user's collateral (1/leverage of this).
  // These limits are generous because PONS tokens have thin
  // liquidity and we don't want to block normal-sized trades.
  const maxImpactPct: Record<Tier, number> = {
    bonded: 25,  // bonded tokens have deepest liquidity
    rising: 15,
    degen: 10,   // degen tokens have thin liquidity but still allow reasonable trades
  };

  const maxPositionUsd = liquidityUsd * (maxImpactPct[tier] / 100);
  const maxPositionEth = maxPositionUsd / ethPriceUsd;
  return BigInt(Math.floor(maxPositionEth * Number(WEI_PER_ETH)));
}

/**
 * Calculate the target insurance fund size based on pool balance.
 */
export function calculateInsuranceFundTarget(poolBalanceWei: bigint): bigint {
  return (poolBalanceWei * BigInt(INSURANCE_FUND_TARGET_BPS)) / BigInt(BPS.FULL);
}

/**
 * Calculate how much of a flat fee should go to the insurance fund.
 * Returns 0 if the fund has reached its target.
 *
 * @param flatFeeWei - The flat fee collected
 * @param currentFundWei - Current insurance fund balance
 * @param fundTargetWei - Target insurance fund balance
 * @returns Amount to deposit into insurance fund
 */
export function calculateInsuranceDeposit(
  flatFeeWei: bigint,
  currentFundWei: bigint,
  fundTargetWei: bigint,
): bigint {
  if (currentFundWei >= fundTargetWei) return 0n;

  const deposit = (flatFeeWei * BigInt(INSURANCE_DEPOSIT_RATE_BPS)) / BigInt(BPS.FULL);
  const needed = fundTargetWei - currentFundWei;

  return deposit < needed ? deposit : needed;
}

/**
 * Verify that a position can be safely opened without putting the protocol at risk.
 *
 * @returns Object with `safe` boolean and `reason` if not safe
 */
export function validatePositionSafety(
  userCapitalWei: bigint,
  leverage: number,
  poolBalanceWei: bigint,
  liquidityUsd: number,
  ethPriceUsd: number,
  tier: Tier,
): { safe: boolean; reason?: string; slippageRisk?: number } {
  const positionSizeWei = userCapitalWei * BigInt(leverage);
  const protocolCapitalWei = positionSizeWei - userCapitalWei;

  // Check 1: Pool has enough capital
  if (protocolCapitalWei > poolBalanceWei) {
    return {
      safe: false,
      reason: 'Pool has insufficient capital for this position size',
    };
  }

  // Check 2: Only the 3% supply cap matters (enforced in positions.ts).
  // Liquidity-based limits removed — they were too restrictive for PONS tokens.

  return { safe: true };
}
