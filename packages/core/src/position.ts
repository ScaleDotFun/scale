// ──────────────────────────────────────────────
// FRONT PROTOCOL — Position Management Logic
// ──────────────────────────────────────────────

import {
  Tier,
  PositionPreview,
  PositionOpenParams,
  MAX_POSITION_DURATION_MS,
  LAMPORTS_PER_SOL,
  SAFETY_BUFFER_BPS,
  BPS,
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

/** Minimum user capital: 0.01 SOL */
const MIN_USER_CAPITAL_LAMPORTS = LAMPORTS_PER_SOL / 100n;

/** Maximum user capital: 10 SOL */
const MAX_USER_CAPITAL_LAMPORTS = LAMPORTS_PER_SOL * 10n;

/**
 * Validate parameters for opening a new position.
 */
export function validatePositionOpen(
  params: PositionOpenParams,
  tier: Tier,
  poolBalanceLamports: bigint,
): ValidationResult {
  const errors: string[] = [];

  // Validate capital bounds
  if (params.userCapitalLamports < MIN_USER_CAPITAL_LAMPORTS) {
    errors.push(`Minimum capital is 0.01 SOL`);
  }
  if (params.userCapitalLamports > MAX_USER_CAPITAL_LAMPORTS) {
    errors.push(`Maximum capital is 10 SOL`);
  }

  // Validate leverage
  if (!isValidLeverage(params.leverage, tier)) {
    const max = TIER_CONFIGS[tier].maxLeverage;
    errors.push(`Leverage must be 1-${max}x for ${tier} tier`);
  }

  // Validate pool has enough capital
  const protocolCapital = calculateProtocolCapital(
    params.userCapitalLamports,
    params.leverage,
  );
  if (protocolCapital > poolBalanceLamports) {
    errors.push(
      `Pool has insufficient capital. Need ${formatSol(protocolCapital)} SOL, pool has ${formatSol(poolBalanceLamports)} SOL`,
    );
  }

  // Validate wallet address format (basic check)
  if (!params.userWallet || params.userWallet.length < 32 || params.userWallet.length > 44) {
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
  userCapitalLamports: bigint,
  leverage: number,
  tier: Tier,
): PositionPreview {
  const config = TIER_CONFIGS[tier];
  const positionSize = calculatePositionSize(userCapitalLamports, leverage);
  const protocolCapital = calculateProtocolCapital(userCapitalLamports, leverage);
  const flatFee = calculateFlatFee(positionSize, tier);
  const scenarios = generateScenarios(userCapitalLamports, protocolCapital, tier);

  return {
    tokenAddress: '',  // filled by caller
    tier,
    tierEmoji: config.emoji,
    userCapitalLamports,
    leverage,
    positionSizeLamports: positionSize,
    protocolCapitalLamports: protocolCapital,
    flatFeeLamports: flatFee,
    flatFeePct: getFlatFeePercent(tier),
    exitThresholdPct: getExitThresholdPercent(tier),
    maxDurationHours: 24,
    profitLockPct: 30,
    scenarioIf2x: {
      label: 'If 2x',
      priceMovePercent: 100,
      totalValueLamports: positionSize * 2n,
      profitLamports: positionSize,
      userCashoutLamports: scenarios.if2x.userCashout,
      userLockLamports: scenarios.if2x.userLock,
      maxLossLamports: 0n,
    },
    scenarioIf3x: {
      label: 'If 3x',
      priceMovePercent: 200,
      totalValueLamports: positionSize * 3n,
      profitLamports: positionSize * 2n,
      userCashoutLamports: scenarios.if3x.userCashout,
      userLockLamports: scenarios.if3x.userLock,
      maxLossLamports: 0n,
    },
    scenarioIfDump: {
      label: 'If dump',
      priceMovePercent: getExitThresholdPercent(tier),
      totalValueLamports: 0n,
      profitLamports: 0n,
      userCashoutLamports: 0n,
      userLockLamports: 0n,
      maxLossLamports: scenarios.ifDump.maxLoss,
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

function formatSol(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4);
}
