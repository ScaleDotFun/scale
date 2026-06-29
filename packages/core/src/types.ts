// ──────────────────────────────────────────────
// FRONT PROTOCOL — Shared Types
// ──────────────────────────────────────────────

/** Risk tier for a listed token */
export type Tier = 'bonded' | 'rising' | 'degen';

/** Position status */
export type PositionStatus =
  | 'open'
  | 'closed_profit'
  | 'closed_loss'
  | 'liquidated'
  | 'timed_out';

/** Creator payout status */
export type PayoutStatus = 'pending' | 'claimable' | 'claimed';

/** Pool ledger entry type */
export type PoolLedgerType =
  | 'fee_claim'
  | 'position_open'
  | 'position_close'
  | 'profit_recycle'
  | 'creator_payout'
  | 'burn'
  | 'insurance_deposit'
  | 'insurance_withdrawal';

// ──────────────────────────────────────────────
// Risk tier configuration
// ──────────────────────────────────────────────

export interface TierConfig {
  tier: Tier;
  label: string;
  emoji: string;
  maxLeverage: number;
  exitThresholdBps: number;   // basis points, e.g. -1500 = -15%
  flatFeeBps: number;         // basis points, e.g. 200 = 2%
  minMarketCap: number;       // USD
  minLiquidity: number;       // USD
  requiresBonded: boolean;
}

// ──────────────────────────────────────────────
// Position types
// ──────────────────────────────────────────────

export interface PositionOpenParams {
  userWallet: string;
  tokenAddress: string;
  userCapitalLamports: bigint;
  leverage: number;
  slippageBps?: number;
}

export interface PositionPreview {
  tokenAddress: string;
  tier: Tier;
  tierEmoji: string;
  userCapitalLamports: bigint;
  leverage: number;
  positionSizeLamports: bigint;
  protocolCapitalLamports: bigint;
  flatFeeLamports: bigint;
  flatFeePct: number;
  exitThresholdPct: number;
  maxDurationHours: number;
  profitLockPct: number;
  // Scenario projections
  scenarioIf2x: ScenarioProjection;
  scenarioIf3x: ScenarioProjection;
  scenarioIfDump: ScenarioProjection;
}

export interface ScenarioProjection {
  label: string;
  priceMovePercent: number;
  totalValueLamports: bigint;
  profitLamports: bigint;
  userCashoutLamports: bigint;
  userLockLamports: bigint;
  maxLossLamports: bigint;
}

// ──────────────────────────────────────────────
// P&L types
// ──────────────────────────────────────────────

export interface PnLResult {
  totalValueLamports: bigint;
  totalProfitLamports: bigint;
  isProfitable: boolean;
  // User side
  userGrossProfitLamports: bigint;  // 70% of profit → SOL to user
  userLockLamports: bigint;         // 30% of profit → buy & lock $FRONT
  userCashoutLamports: bigint;      // 70% of profit (same as gross, all cash)
  // Protocol side
  protocolProfitShareLamports: bigint; // 0% — protocol earns from fees, not profit
  flatFeeLamports: bigint;
  totalProtocolRevenueLamports: bigint;
}

// ──────────────────────────────────────────────
// Revenue split types
// ──────────────────────────────────────────────

export interface RevenueBreakdown {
  totalRevenueLamports: bigint;
  creatorPayoutLamports: bigint;   // 30%
  burnAmountLamports: bigint;      // 20%
  poolReturnLamports: bigint;      // 50%
}

export interface FullDistribution {
  pnl: PnLResult;
  revenue: RevenueBreakdown;
  capitalReturn: {
    userCapitalLamports: bigint;
    protocolCapitalLamports: bigint;
  };
}

// ──────────────────────────────────────────────
// Token types
// ──────────────────────────────────────────────

export interface ListedToken {
  address: string;
  name: string;
  symbol: string;
  tier: Tier;
  creatorWallet: string;
  listedAt: Date;
  isActive: boolean;
  totalTradingVolume: bigint;
  totalCreatorPayouts: bigint;
}

export interface TokenMarketData {
  address: string;
  priceUsd: number;
  priceSol: number;
  marketCapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  isBonded: boolean;
}

// ──────────────────────────────────────────────
// API response types
// ──────────────────────────────────────────────

export interface ProtocolStats {
  totalBurnedLamports: bigint;
  totalBurnedTokens: bigint;
  totalLockedLamports: bigint;
  totalLockedTokens: bigint;
  poolSizeLamports: bigint;
  insuranceFundLamports: bigint;
  totalCreatorPayoutsLamports: bigint;
  totalTradesExecuted: number;
  totalListedTokens: number;
  activePositions: number;
}

export interface CreatorDashboard {
  tokenAddress: string;
  tokenSymbol: string;
  tier: Tier;
  listedAt: Date;
  totalTradingVolume: bigint;
  totalFeesGenerated: bigint;
  totalEarnings: bigint;
  todayTradingVolume: bigint;
  todayFeesGenerated: bigint;
  todayEarnings: bigint;
  unclaimedEarnings: bigint;
  feesRedirected: bigint;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

/** BPS constants */
export const BPS = {
  /** 1 basis point = 0.01% */
  ONE: 1,
  /** 100% in basis points */
  FULL: 10_000,
} as const;

/** Lamports per SOL */
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/** Max position duration in milliseconds (24 hours) */
export const MAX_POSITION_DURATION_MS = 24 * 60 * 60 * 1000;

/** Profit lock duration in milliseconds (7 days) */
export const PROFIT_LOCK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

/** Revenue split basis points (from protocol fees — flat fee revenue) */
export const REVENUE_SPLIT = {
  CREATOR: 3_000,  // 30%
  BURN: 2_000,     // 20%
  POOL: 5_000,     // 50%
} as const;

/**
 * Profit split between user and $FRONT lock
 *
 * When a position is profitable:
 *   70% of profit → SOL directly to user (cash out)
 *   30% of profit → auto-buy $FRONT, locked for 7 days, then claimable by user
 *
 * The protocol does NOT take a cut of profit — it earns from flat fees and
 * creator reward inflows only. This keeps the protocol trustless and aligned.
 */
export const PROFIT_SPLIT = {
  USER_CASH: 7_000,   // 70% → SOL to user
  USER_LOCK: 3_000,   // 30% → buy $FRONT & lock 7 days for user
} as const;

/**
 * Safety buffer for liquidation (in basis points of user collateral).
 * Protocol closes the position when user's collateral erodes to this buffer,
 * ensuring the protocol never loses capital even with slippage.
 *
 * 500 bps = 5% buffer → position closes when 95% of collateral is consumed.
 */
export const SAFETY_BUFFER_BPS = 500;

/**
 * Insurance fund target as percentage of pool (in basis points).
 * 200 bps = 2% of pool size is held as insurance.
 */
export const INSURANCE_FUND_TARGET_BPS = 200;

/**
 * Insurance deposit rate — percentage of flat fee revenue allocated to insurance fund
 * until it reaches the target (in basis points).
 * 1000 bps = 10% of flat fee revenue goes to insurance.
 */
export const INSURANCE_DEPOSIT_RATE_BPS = 1_000;
