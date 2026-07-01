// ──────────────────────────────────────────────
// FRONT PROTOCOL — Safety & Risk Calculations
// ──────────────────────────────────────────────
//
// Centralized safety logic to guarantee the protocol never loses money.
// Key principles:
//   1. Liquidation fires BEFORE user collateral is fully consumed (buffer)
//   2. Position size is limited by pool liquidity and token depth
//   3. Insurance fund covers edge cases (flash crashes, slippage)
//

import {
  LAMPORTS_PER_SOL,
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
 * @param positionSizeLamports - Total position size
 * @param liquidityUsd - Token's total liquidity in USD
 * @param solPriceUsd - Current SOL price in USD
 * @returns Risk score 0-100 (0 = no risk, 100 = extremely risky)
 */
export function estimateSlippageRisk(
  positionSizeLamports: bigint,
  liquidityUsd: number,
  solPriceUsd: number,
): number {
  if (liquidityUsd <= 0 || solPriceUsd <= 0) return 100;

  const positionSol = Number(positionSizeLamports) / Number(LAMPORTS_PER_SOL);
  const positionUsd = positionSol * solPriceUsd;

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
 * @param solPriceUsd - Current SOL price in USD
 * @param tier - Risk tier
 * @returns Maximum position size in lamports
 */
export function maxSafePositionSize(
  liquidityUsd: number,
  solPriceUsd: number,
  tier: Tier,
): bigint {
  if (liquidityUsd <= 0 || solPriceUsd <= 0) return 0n;

  // Max impact percentages by tier.
  // Note: the "position size" is the leveraged notional, but actual
  // on-chain buy is only the user's collateral (1/leverage of this).
  // These limits are generous because pump.fun tokens have thin
  // liquidity and we don't want to block normal-sized trades.
  const maxImpactPct: Record<Tier, number> = {
    bonded: 25,  // bonded tokens have deepest liquidity
    rising: 15,
    degen: 10,   // degen tokens have thin liquidity but still allow reasonable trades
  };

  const maxPositionUsd = liquidityUsd * (maxImpactPct[tier] / 100);
  const maxPositionSol = maxPositionUsd / solPriceUsd;
  return BigInt(Math.floor(maxPositionSol * Number(LAMPORTS_PER_SOL)));
}

/**
 * Calculate the target insurance fund size based on pool balance.
 */
export function calculateInsuranceFundTarget(poolBalanceLamports: bigint): bigint {
  return (poolBalanceLamports * BigInt(INSURANCE_FUND_TARGET_BPS)) / BigInt(BPS.FULL);
}

/**
 * Calculate how much of a flat fee should go to the insurance fund.
 * Returns 0 if the fund has reached its target.
 *
 * @param flatFeeLamports - The flat fee collected
 * @param currentFundLamports - Current insurance fund balance
 * @param fundTargetLamports - Target insurance fund balance
 * @returns Amount to deposit into insurance fund
 */
export function calculateInsuranceDeposit(
  flatFeeLamports: bigint,
  currentFundLamports: bigint,
  fundTargetLamports: bigint,
): bigint {
  if (currentFundLamports >= fundTargetLamports) return 0n;

  const deposit = (flatFeeLamports * BigInt(INSURANCE_DEPOSIT_RATE_BPS)) / BigInt(BPS.FULL);
  const needed = fundTargetLamports - currentFundLamports;

  return deposit < needed ? deposit : needed;
}

/**
 * Verify that a position can be safely opened without putting the protocol at risk.
 *
 * @returns Object with `safe` boolean and `reason` if not safe
 */
export function validatePositionSafety(
  userCapitalLamports: bigint,
  leverage: number,
  poolBalanceLamports: bigint,
  liquidityUsd: number,
  solPriceUsd: number,
  tier: Tier,
): { safe: boolean; reason?: string; slippageRisk?: number } {
  const positionSizeLamports = userCapitalLamports * BigInt(leverage);
  const protocolCapitalLamports = positionSizeLamports - userCapitalLamports;

  // Check 1: Pool has enough capital
  if (protocolCapitalLamports > poolBalanceLamports) {
    return {
      safe: false,
      reason: 'Pool has insufficient capital for this position size',
    };
  }

  // Check 2: Position size vs liquidity (market impact)
  const maxSize = maxSafePositionSize(liquidityUsd, solPriceUsd, tier);
  if (maxSize > 0n && positionSizeLamports > maxSize) {
    return {
      safe: false,
      reason: 'Position too large relative to token liquidity — exit slippage would be too high',
    };
  }

  // Check 3: Slippage risk assessment
  const slippageRisk = estimateSlippageRisk(positionSizeLamports, liquidityUsd, solPriceUsd);
  if (slippageRisk > 95) {
    return {
      safe: false,
      reason: 'Slippage risk too high — token liquidity too thin for this position size',
      slippageRisk,
    };
  }

  return { safe: true, slippageRisk };
}
