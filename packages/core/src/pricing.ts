// ──────────────────────────────────────────────
// FRONT PROTOCOL — Tier Pricing & Fee Calculation
// ──────────────────────────────────────────────

import {
  Tier,
  TierConfig,
  BPS,
} from './types.js';

// ──────────────────────────────────────────────
// Tier configuration (matches spec exactly)
// ──────────────────────────────────────────────

export const TIER_CONFIGS: Record<Tier, TierConfig> = {
  bonded: {
    tier: 'bonded',
    label: 'Bonded',
    emoji: '🟢',
    maxLeverage: 7,
    exitThresholdBps: -1_500,  // -15%
    flatFeeBps: 200,           // 2%
    minMarketCap: 1_000_000,   // $1M
    minLiquidity: 50_000,      // $50K
    requiresBonded: true,
  },
  rising: {
    tier: 'rising',
    label: 'Rising',
    emoji: '🟡',
    maxLeverage: 5,
    exitThresholdBps: -2_000,  // -20%
    flatFeeBps: 300,           // 3%
    minMarketCap: 100_000,     // $100K
    minLiquidity: 10_000,      // $10K
    requiresBonded: false,
  },
  degen: {
    tier: 'degen',
    label: 'Degen',
    emoji: '🔴',
    maxLeverage: 3,
    exitThresholdBps: -3_000,  // -30%
    flatFeeBps: 500,           // 5%
    minMarketCap: 0,
    minLiquidity: 5_000,       // $5K
    requiresBonded: false,
  },
};

/** Minimum liquidity to allow any trading (below = blocked) */
export const BLOCKED_LIQUIDITY_THRESHOLD_USD = 5_000;

// ──────────────────────────────────────────────
// Tier determination
// ──────────────────────────────────────────────

/**
 * Determine the risk tier for a token based on on-chain data.
 * Returns null if the token should be blocked from trading.
 */
export function determineTier(
  marketCapUsd: number,
  liquidityUsd: number,
  isBonded: boolean,
): TierConfig | null {
  // Block if liquidity too low
  if (liquidityUsd < BLOCKED_LIQUIDITY_THRESHOLD_USD) {
    return null;
  }

  // Check tiers in order of strictness (bonded → rising → degen)
  if (
    isBonded &&
    marketCapUsd >= TIER_CONFIGS.bonded.minMarketCap &&
    liquidityUsd >= TIER_CONFIGS.bonded.minLiquidity
  ) {
    return TIER_CONFIGS.bonded;
  }

  if (
    marketCapUsd >= TIER_CONFIGS.rising.minMarketCap &&
    liquidityUsd >= TIER_CONFIGS.rising.minLiquidity
  ) {
    return TIER_CONFIGS.rising;
  }

  return TIER_CONFIGS.degen;
}

/**
 * Get the config for a known tier.
 */
export function getTierConfig(tier: Tier): TierConfig {
  return TIER_CONFIGS[tier];
}

// ──────────────────────────────────────────────
// Fee calculation
// ──────────────────────────────────────────────

/**
 * Calculate the flat fee for a position.
 * @param positionSizeLamports - Total position size (user + protocol capital)
 * @param tier - Risk tier
 * @returns Fee amount in lamports
 */
export function calculateFlatFee(
  positionSizeLamports: bigint,
  tier: Tier,
): bigint {
  const config = TIER_CONFIGS[tier];
  return (positionSizeLamports * BigInt(config.flatFeeBps)) / BigInt(BPS.FULL);
}

/**
 * Calculate the flat fee percentage for display.
 */
export function getFlatFeePercent(tier: Tier): number {
  return TIER_CONFIGS[tier].flatFeeBps / 100;
}

/**
 * Calculate the exit threshold percentage for display.
 */
export function getExitThresholdPercent(tier: Tier): number {
  return TIER_CONFIGS[tier].exitThresholdBps / 100;
}

/**
 * Calculate the max leverage for a tier.
 */
export function getMaxLeverage(tier: Tier): number {
  return TIER_CONFIGS[tier].maxLeverage;
}

/**
 * Validate that the requested leverage is within bounds.
 */
export function isValidLeverage(leverage: number, tier: Tier): boolean {
  const max = TIER_CONFIGS[tier].maxLeverage;
  return leverage >= 1 && leverage <= max && Number.isInteger(leverage);
}

/**
 * Calculate protocol capital needed for a position.
 * Protocol capital = (user_capital * leverage) - user_capital
 */
export function calculateProtocolCapital(
  userCapitalLamports: bigint,
  leverage: number,
): bigint {
  return userCapitalLamports * BigInt(leverage) - userCapitalLamports;
}

/**
 * Calculate the total position size.
 */
export function calculatePositionSize(
  userCapitalLamports: bigint,
  leverage: number,
): bigint {
  return userCapitalLamports * BigInt(leverage);
}
