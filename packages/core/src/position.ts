// ──────────────────────────────────────────────
// LOADED PROTOCOL — Position Management Logic
// ──────────────────────────────────────────────

import {
  Tier,
  PositionPreview,
  PositionOpenParams,
  MAX_POSITION_DURATION_MS,
  WEI_PER_ETH,
  SAFETY_BUFFER_BPS,
  BPS,
  isEvmAddress,
} from './types.js';
import {
  TIER_CONFIGS,
  determineTier,
  calculateFlatFee,
  calculateProtocolCapital,
  calculatePositionSize,
  isValidLeverage,
  getExitThresholdPercent,
  getFlatFeePercent,
} from './pricing.js';
import { generateScenarios, calculateLivePnLPercent } from './pnl.js';

// ──────────────────────────────────────────────
// Position validation
// ──────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Minimum user capital: 0.001 ETH (~a couple of dollars) */
const MIN_USER_CAPITAL_WEI = WEI_PER_ETH / 1_000n;

/** Maximum user capital: 1 ETH per position */
const MAX_USER_CAPITAL_WEI = WEI_PER_ETH;

/**
 * Validate parameters for opening a new position.
 */
export function validatePositionOpen(
  params: PositionOpenParams,
  tier: Tier,
  poolBalanceWei: bigint,
): ValidationResult {
  const errors: string[] = [];

  // Validate capital bounds
  if (params.userCapitalWei < MIN_USER_CAPITAL_WEI) {
    errors.push(`Minimum collateral is 0.001 ETH. Please increase your amount.`);
  }
  if (params.userCapitalWei > MAX_USER_CAPITAL_WEI) {
    errors.push(`Maximum collateral is 1 ETH per position. Please reduce your amount.`);
  }

  // Validate leverage
  if (!isValidLeverage(params.leverage, tier)) {
    const max = TIER_CONFIGS[tier].maxLeverage;
    errors.push(`Max leverage for ${tier} tier is ${max}x. Please select ${max}x or lower.`);
  }

  // Validate pool has enough capital
  const protocolCapital = calculateProtocolCapital(
    params.userCapitalWei,
    params.leverage,
  );
  if (protocolCapital > poolBalanceWei) {
    errors.push(
      `The protocol pool doesn't have enough capital right now. ` +
      `Your position needs ${formatEth(protocolCapital)} ETH from the pool, but only ${formatEth(poolBalanceWei)} ETH is available. ` +
      `Try a smaller position size, lower leverage, or wait for other positions to close.`,
    );
  }

  // Validate wallet address format (0x + 40 hex, not merely a plausible length)
  if (!isEvmAddress(params.userWallet ?? '')) {
    errors.push('Invalid wallet address');
  }

  return { valid: errors.length === 0, errors };
}

// ──────────────────────────────────────────────
// Position preview (shown before confirming)
// ──────────────────────────────────────────────

/**
 * Generate a full position preview for the UI.
 */
export function generatePositionPreview(
  userCapitalWei: bigint,
  leverage: number,
  tier: Tier,
): PositionPreview {
  const config = TIER_CONFIGS[tier];
  const positionSize = calculatePositionSize(userCapitalWei, leverage);
  const protocolCapital = calculateProtocolCapital(userCapitalWei, leverage);
  const flatFee = calculateFlatFee(positionSize, tier);
  const scenarios = generateScenarios(userCapitalWei, protocolCapital, tier);

  return {
    tokenAddress: '',  // filled by caller
    tier,
    tierEmoji: config.emoji,
    userCapitalWei,
    leverage,
    positionSizeWei: positionSize,
    protocolCapitalWei: protocolCapital,
    flatFeeWei: flatFee,
    flatFeePct: getFlatFeePercent(tier),
    exitThresholdPct: getExitThresholdPercent(tier),
    maxDurationHours: 24,
    profitLockPct: 30,
    scenarioIf2x: {
      label: 'If 2x',
      priceMovePercent: 100,
      totalValueWei: positionSize * 2n,
      profitWei: positionSize,
      userCashoutWei: scenarios.if2x.userCashout,
      userLockWei: scenarios.if2x.userLock,
      maxLossWei: 0n,
    },
    scenarioIf3x: {
      label: 'If 3x',
      priceMovePercent: 200,
      totalValueWei: positionSize * 3n,
      profitWei: positionSize * 2n,
      userCashoutWei: scenarios.if3x.userCashout,
      userLockWei: scenarios.if3x.userLock,
      maxLossWei: 0n,
    },
    scenarioIfDump: {
      label: 'If dump',
      priceMovePercent: getExitThresholdPercent(tier),
      totalValueWei: 0n,
      profitWei: 0n,
      userCashoutWei: 0n,
      userLockWei: 0n,
      maxLossWei: scenarios.ifDump.maxLoss,
    },
  };
}

// ──────────────────────────────────────────────
// Auto-close logic (with safety buffer)
// ──────────────────────────────────────────────

/**
 * Check if a position should be auto-closed based on price or time.
 *
 * Safety buffer: the position closes BEFORE the user's full collateral is
 * consumed, leaving a buffer to absorb slippage and ensure the protocol
 * NEVER loses capital.
 *
 * Exit triggers:
 * 1. Leveraged P&L hits the exit threshold (adjusted by safety buffer)
 * 2. Position exceeds 24h max duration
 */
export function shouldAutoClose(
  entryPrice: number,
  currentPrice: number,
  leverage: number,
  exitThresholdBps: number,
  openedAtMs: number,
  nowMs: number = Date.now(),
): { shouldClose: boolean; reason: 'threshold' | 'timeout' | null } {
  // Apply safety buffer — close slightly before the raw threshold
  // This ensures even with slippage, the protocol recovers its capital.
  const safetyAdjustedThresholdBps = exitThresholdBps + SAFETY_BUFFER_BPS;

  // Check exit threshold — use the shared PnL calculation to stay in sync with UI
  const leveragedPnlPct = calculateLivePnLPercent(entryPrice, currentPrice, leverage);
  const exitThresholdPct = safetyAdjustedThresholdBps / 100;

  if (leveragedPnlPct <= exitThresholdPct) {
    return { shouldClose: true, reason: 'threshold' };
  }

  // Check 24h timeout
  if (nowMs - openedAtMs >= MAX_POSITION_DURATION_MS) {
    return { shouldClose: true, reason: 'timeout' };
  }

  return { shouldClose: false, reason: null };
}

/**
 * Calculate the price at which auto-close triggers.
 * Includes safety buffer — closes before full collateral is consumed.
 */
export function calculateExitPrice(
  entryPrice: number,
  tier: Tier,
  leverage: number,
): number {
  const config = TIER_CONFIGS[tier];
  // Apply safety buffer to exit threshold
  const safeThresholdBps = config.exitThresholdBps + SAFETY_BUFFER_BPS;
  // Convert bps → fraction in a single step, then divide by leverage
  // e.g., -1000 bps = -10%, on 7x leverage = price drops by ~1.43%
  const priceDrop = (safeThresholdBps / 10000) / leverage;
  return entryPrice * (1 + priceDrop);
}

/**
 * Calculate time remaining before auto-close (in ms).
 */
export function timeRemainingMs(openedAtMs: number, nowMs: number = Date.now()): number {
  const remaining = openedAtMs + MAX_POSITION_DURATION_MS - nowMs;
  return Math.max(0, remaining);
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatEth(wei: bigint): string {
  return (Number(wei) / Number(WEI_PER_ETH)).toFixed(4);
}
