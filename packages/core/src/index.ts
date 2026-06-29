// ──────────────────────────────────────────────
// FRONT PROTOCOL — Core Package Barrel Export
// ──────────────────────────────────────────────

// Types & constants
export * from './types';

// Pricing & tier logic
export {
  TIER_CONFIGS,
  BLOCKED_LIQUIDITY_THRESHOLD_USD,
  determineTier,
  getTierConfig,
  calculateFlatFee,
  getFlatFeePercent,
  getExitThresholdPercent,
  getMaxLeverage,
  isValidLeverage,
  calculateProtocolCapital,
  calculatePositionSize,
} from './pricing';

// P&L calculation
export {
  calculatePnL,
  calculateLivePnLPercent,
  calculateMaxLoss,
  generateScenarios,
} from './pnl';

// Revenue distribution
export {
  splitRevenue,
  calculateFullDistribution,
  formatRevenueBreakdown,
} from './revenue';

// Position management
export {
  validatePositionOpen,
  generatePositionPreview,
  shouldAutoClose,
  calculateExitPrice,
  timeRemainingMs,
} from './position';
export type { ValidationResult } from './position';

// Safety & risk
export {
  calculateSafeExitThreshold,
  estimateSlippageRisk,
  maxSafePositionSize,
  calculateInsuranceFundTarget,
  calculateInsuranceDeposit,
  validatePositionSafety,
} from './safety';
