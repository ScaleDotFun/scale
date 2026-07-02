import { describe, it, expect } from 'vitest';
import {
  shouldAutoClose,
  validatePositionOpen,
  calculateExitPrice,
  generatePositionPreview,
  timeRemainingMs,
} from '../position.js';
import {
  LAMPORTS_PER_SOL,
  MAX_POSITION_DURATION_MS,
  SAFETY_BUFFER_BPS,
} from '../types.js';
import { TIER_CONFIGS } from '../pricing.js';

const ONE_SOL = LAMPORTS_PER_SOL;

// ──────────────────────────────────────────────
// shouldAutoClose
// ──────────────────────────────────────────────

describe('shouldAutoClose', () => {
  const exitThresholdBps = -1_500; // bonded: -15%
  const leverage = 7;
  const now = Date.now();
  const openedAt = now - 1000; // opened 1 second ago

  it('closes when leveraged PnL drops below safety-adjusted threshold', () => {
    // Safety buffer = 500 bps → adjusted threshold = -1500 + 500 = -1000 bps = -10%
    // At 7x leverage, -10% PnL requires price drop of ~1.43%
    // Price drop of 2% → leveraged PnL = -14% which is < -10%
    const result = shouldAutoClose(1.0, 0.98, leverage, exitThresholdBps, openedAt, now);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('threshold');
  });

  it('does NOT close when PnL is above safety-adjusted threshold', () => {
    // Price barely moved → PnL well above threshold
    const result = shouldAutoClose(1.0, 0.999, leverage, exitThresholdBps, openedAt, now);
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('does NOT close on price increase', () => {
    const result = shouldAutoClose(1.0, 1.5, leverage, exitThresholdBps, openedAt, now);
    expect(result.shouldClose).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('closes when price is just past the threshold', () => {
    // Safety-adjusted threshold = (-1500 + 500) / 100 = -10%
    // Need leveraged PnL <= -10% at 7x leverage
    // price change % * 7 = -10 → price change = -10/7 ≈ -1.4286%
    // Nudge slightly past to avoid floating-point rounding at boundary
    const priceJustPast = 1.0 * (1 - 10 / (7 * 100)) - 0.0001;
    const result = shouldAutoClose(1.0, priceJustPast, leverage, exitThresholdBps, openedAt, now);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('threshold');
  });

  it('closes on 24h timeout', () => {
    const openedLongAgo = now - MAX_POSITION_DURATION_MS;
    const result = shouldAutoClose(1.0, 1.0, leverage, exitThresholdBps, openedLongAgo, now);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('timeout');
  });

  it('does NOT timeout before 24h', () => {
    const justBefore = now - (MAX_POSITION_DURATION_MS - 1);
    const result = shouldAutoClose(1.0, 1.0, leverage, exitThresholdBps, justBefore, now);
    expect(result.shouldClose).toBe(false);
  });

  it('applies safety buffer — closes earlier than raw threshold', () => {
    // Raw threshold = -15% at 7x → price drop of ~2.14%
    // Safety-adjusted = -10% at 7x → price drop of ~1.43%
    // Price at 0.985 → leveraged PnL = -1.5% * 7 = -10.5% < -10% → close
    // But raw: -10.5% > -15% → would NOT close without safety buffer
    const result = shouldAutoClose(1.0, 0.985, leverage, exitThresholdBps, openedAt, now);
    expect(result.shouldClose).toBe(true);
    expect(result.reason).toBe('threshold');
  });

  describe('degen tier threshold', () => {
    const degenThreshold = -3_000; // -30%
    const degenLeverage = 3;

    it('closes degen position at safety-adjusted threshold', () => {
      // Adjusted = -3000 + 500 = -2500 bps = -25%
      // At 3x, need price drop of 25/3 ≈ 8.33%
      const result = shouldAutoClose(1.0, 0.90, degenLeverage, degenThreshold, openedAt, now);
      // -10% price * 3x = -30% < -25% → close
      expect(result.shouldClose).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────
// validatePositionOpen
// ──────────────────────────────────────────────

describe('validatePositionOpen', () => {
  const validParams = {
    userWallet: 'A'.repeat(44), // valid length Solana address
    tokenAddress: 'B'.repeat(44),
    userCapitalLamports: ONE_SOL, // 1 SOL
    leverage: 3,
  };
  const tier = 'degen' as const;
  const bigPool = ONE_SOL * 1000n; // 1000 SOL pool

  it('validates a correct position', () => {
    const result = validatePositionOpen(validParams, tier, bigPool);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects capital below minimum (0.01 SOL)', () => {
    const result = validatePositionOpen(
      { ...validParams, userCapitalLamports: ONE_SOL / 200n }, // 0.005 SOL
      tier,
      bigPool,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Minimum collateral'));
  });

  it('rejects capital above maximum (10 SOL)', () => {
    const result = validatePositionOpen(
      { ...validParams, userCapitalLamports: ONE_SOL * 11n },
      tier,
      bigPool,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Maximum collateral'));
  });

  it('accepts capital at exact minimum (0.01 SOL)', () => {
    const result = validatePositionOpen(
      { ...validParams, userCapitalLamports: ONE_SOL / 100n },
      tier,
      bigPool,
    );
    expect(result.valid).toBe(true);
  });

  it('accepts capital at exact maximum (10 SOL)', () => {
    const result = validatePositionOpen(
      { ...validParams, userCapitalLamports: ONE_SOL * 10n },
      tier,
      bigPool,
    );
    expect(result.valid).toBe(true);
  });

  it('rejects invalid leverage for tier', () => {
    const result = validatePositionOpen(
      { ...validParams, leverage: 4 }, // degen max is 3
      tier,
      bigPool,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Max leverage'));
  });

  it('rejects when pool has insufficient capital', () => {
    const tinyPool = ONE_SOL / 10n; // 0.1 SOL pool
    const result = validatePositionOpen(
      { ...validParams, leverage: 3 }, // needs 2 SOL from pool
      tier,
      tinyPool,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining("doesn't have enough capital"));
  });

  it('rejects invalid wallet address (too short)', () => {
    const result = validatePositionOpen(
      { ...validParams, userWallet: 'abc' },
      tier,
      bigPool,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('wallet'));
  });

  it('rejects empty wallet address', () => {
    const result = validatePositionOpen(
      { ...validParams, userWallet: '' },
      tier,
      bigPool,
    );
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors simultaneously', () => {
    const result = validatePositionOpen(
      {
        userWallet: '', // invalid
        tokenAddress: 'x',
        userCapitalLamports: 1n, // below min
        leverage: 10, // above max
      },
      tier,
      0n, // no pool capital
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ──────────────────────────────────────────────
// calculateExitPrice
// ──────────────────────────────────────────────

describe('calculateExitPrice', () => {
  it('returns a price below entry for long positions', () => {
    const exitPrice = calculateExitPrice(1.0, 'bonded', 7);
    expect(exitPrice).toBeLessThan(1.0);
  });

  it('exit price is closer to entry with safety buffer applied', () => {
    // The safety buffer makes the exit trigger earlier (higher price)
    const entryPrice = 100;
    const exitPriceBonded = calculateExitPrice(entryPrice, 'bonded', 7);
    // Raw threshold: -15%, safety: +5% → -10%
    // At 7x: price drop = 10/7/100 ≈ 1.43%
    const expectedDrop = ((TIER_CONFIGS.bonded.exitThresholdBps + SAFETY_BUFFER_BPS) / 10000) / 7;
    const expected = entryPrice * (1 + expectedDrop);
    expect(exitPriceBonded).toBeCloseTo(expected, 6);
  });

  it('lower leverage = larger price drop before exit', () => {
    const exitAt3x = calculateExitPrice(1.0, 'degen', 3);
    const exitAt1x = calculateExitPrice(1.0, 'degen', 1);
    // At 1x leverage, price has to drop more before hitting the threshold
    expect(exitAt1x).toBeLessThan(exitAt3x);
  });
});

// ──────────────────────────────────────────────
// generatePositionPreview
// ──────────────────────────────────────────────

describe('generatePositionPreview', () => {
  it('returns correct position size at 3x', () => {
    const preview = generatePositionPreview(ONE_SOL, 3, 'degen');
    expect(preview.positionSizeLamports).toBe(3n * ONE_SOL);
    expect(preview.protocolCapitalLamports).toBe(2n * ONE_SOL);
  });

  it('includes correct tier metadata', () => {
    const preview = generatePositionPreview(ONE_SOL, 5, 'rising');
    expect(preview.tier).toBe('rising');
    expect(preview.tierEmoji).toBe('R');
    expect(preview.flatFeePct).toBe(3); // 300 bps = 3%
  });

  it('scenarios show increasing profit for 2x → 3x', () => {
    const preview = generatePositionPreview(ONE_SOL, 3, 'degen');
    expect(preview.scenarioIf3x.userCashoutLamports)
      .toBeGreaterThan(preview.scenarioIf2x.userCashoutLamports);
  });

  it('dump scenario shows max loss', () => {
    const preview = generatePositionPreview(ONE_SOL, 3, 'degen');
    // Max loss = user capital + flat fee
    expect(preview.scenarioIfDump.maxLossLamports).toBeGreaterThan(ONE_SOL);
  });
});

// ──────────────────────────────────────────────
// timeRemainingMs
// ──────────────────────────────────────────────

describe('timeRemainingMs', () => {
  it('returns full duration for a just-opened position', () => {
    const now = Date.now();
    const remaining = timeRemainingMs(now, now);
    expect(remaining).toBe(MAX_POSITION_DURATION_MS);
  });

  it('returns 0 when position has expired', () => {
    const now = Date.now();
    const openedAt = now - MAX_POSITION_DURATION_MS - 1000;
    expect(timeRemainingMs(openedAt, now)).toBe(0);
  });

  it('returns correct remaining time mid-duration', () => {
    const now = Date.now();
    const halfDuration = MAX_POSITION_DURATION_MS / 2;
    const openedAt = now - halfDuration;
    expect(timeRemainingMs(openedAt, now)).toBe(MAX_POSITION_DURATION_MS - halfDuration);
  });
});
