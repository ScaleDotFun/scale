import { describe, it, expect } from 'vitest';
import {
  calculatePnL,
  calculateLivePnLPercent,
  calculateMaxLoss,
  generateScenarios,
} from '../pnl.js';
import { LAMPORTS_PER_SOL, PROFIT_SPLIT, BPS } from '../types.js';

const ONE_SOL = LAMPORTS_PER_SOL;

// ──────────────────────────────────────────────
// calculatePnL — Profitable case
// ──────────────────────────────────────────────

describe('calculatePnL — profitable position', () => {
  it('correctly splits 70/30 on profit (2x price)', () => {
    // 1 SOL user, 2 SOL protocol (3x), price doubles
    const result = calculatePnL(1.0, 2.0, ONE_SOL, 2n * ONE_SOL, 'degen');

    expect(result.isProfitable).toBe(true);
    // Total capital = 3 SOL, price doubled → total value = 6 SOL, profit = 3 SOL
    expect(result.totalValueLamports).toBe(6n * ONE_SOL);
    expect(result.totalProfitLamports).toBe(3n * ONE_SOL);

    // 70% of 3 SOL = 2.1 SOL
    const expectedCashout = (3n * ONE_SOL * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
    expect(result.userCashoutLamports).toBe(expectedCashout);

    // 30% of 3 SOL = 0.9 SOL
    const expectedLock = (3n * ONE_SOL * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);
    expect(result.userLockLamports).toBe(expectedLock);
  });

  it('sets userGrossProfitLamports to total profit', () => {
    const result = calculatePnL(1.0, 1.5, ONE_SOL, ONE_SOL, 'rising');
    expect(result.userGrossProfitLamports).toBe(result.totalProfitLamports);
  });

  it('protocol takes 0% of profit', () => {
    const result = calculatePnL(1.0, 2.0, ONE_SOL, 2n * ONE_SOL, 'degen');
    expect(result.protocolProfitShareLamports).toBe(0n);
  });

  it('protocol revenue is flat fee only', () => {
    const result = calculatePnL(1.0, 2.0, ONE_SOL, 2n * ONE_SOL, 'degen');
    expect(result.totalProtocolRevenueLamports).toBe(result.flatFeeLamports);
    // Degen fee = 5% of the 3 ETH position
    expect(result.flatFeeLamports).toBe((3n * ONE_SOL * 500n) / 10_000n);
  });

  it('handles modest profit (10% price increase)', () => {
    const result = calculatePnL(1.0, 1.1, ONE_SOL, ONE_SOL, 'bonded');
    expect(result.isProfitable).toBe(true);
    // Total capital 2 ETH, 10% increase → value 2.2 ETH, profit 0.2 ETH.
    // The ratio math routes through Number, so allow float-mantissa noise
    // (< 1000 wei = 1e-15 ETH — economically zero at wei scale).
    const expected = (2n * ONE_SOL) / 10n;
    const diff = result.totalProfitLamports > expected
      ? result.totalProfitLamports - expected
      : expected - result.totalProfitLamports;
    expect(diff < 1000n).toBe(true);
  });
});

// ──────────────────────────────────────────────
// calculatePnL — Loss case
// ──────────────────────────────────────────────

describe('calculatePnL — loss position', () => {
  it('returns zero profit values on loss', () => {
    // Price drops 50%
    const result = calculatePnL(1.0, 0.5, ONE_SOL, 2n * ONE_SOL, 'degen');

    expect(result.isProfitable).toBe(false);
    expect(result.userGrossProfitLamports).toBe(0n);
    expect(result.userLockLamports).toBe(0n);
    expect(result.userCashoutLamports).toBe(0n);
    expect(result.protocolProfitShareLamports).toBe(0n);
  });

  it('calculates correct total value on loss', () => {
    // 3 SOL total, price drops 50% → 1.5 SOL remaining
    const result = calculatePnL(1.0, 0.5, ONE_SOL, 2n * ONE_SOL, 'degen');
    expect(result.totalValueLamports).toBe(ONE_SOL + ONE_SOL / 2n); // 1.5 SOL
  });

  it('records negative total profit', () => {
    const result = calculatePnL(1.0, 0.5, ONE_SOL, 2n * ONE_SOL, 'degen');
    expect(result.totalProfitLamports).toBeLessThan(0n);
  });

  it('protocol revenue is still the flat fee on loss', () => {
    const result = calculatePnL(1.0, 0.5, ONE_SOL, 2n * ONE_SOL, 'degen');
    expect(result.totalProtocolRevenueLamports).toBe(result.flatFeeLamports);
  });
});

// ──────────────────────────────────────────────
// calculatePnL — Break-even
// ──────────────────────────────────────────────

describe('calculatePnL — break-even', () => {
  it('returns zero profit when exit price equals entry price', () => {
    const result = calculatePnL(1.0, 1.0, ONE_SOL, ONE_SOL, 'bonded');

    expect(result.totalProfitLamports).toBe(0n);
    expect(result.isProfitable).toBe(false); // 0 is not > 0
    expect(result.userCashoutLamports).toBe(0n);
    expect(result.userLockLamports).toBe(0n);
  });

  it('total value equals total capital at break-even', () => {
    const result = calculatePnL(1.0, 1.0, ONE_SOL, ONE_SOL, 'bonded');
    expect(result.totalValueLamports).toBe(2n * ONE_SOL);
  });
});

// ──────────────────────────────────────────────
// calculatePnL — Large values (BigInt precision)
// ──────────────────────────────────────────────

describe('calculatePnL — BigInt precision with large values', () => {
  it('handles 9000+ SOL positions correctly', () => {
    const largeCapital = ONE_SOL * 9_001n; // 9001 SOL
    const protocolCapital = ONE_SOL * 18_002n; // ~2x leverage protocol side
    const result = calculatePnL(100.0, 200.0, largeCapital, protocolCapital, 'bonded');

    expect(result.isProfitable).toBe(true);
    // Total capital = 27003 SOL, 2x price → 54006 SOL value, 27003 SOL profit
    const expectedProfit = largeCapital + protocolCapital; // 27003 SOL
    expect(result.totalProfitLamports).toBe(expectedProfit);
    expect(result.totalValueLamports).toBe((largeCapital + protocolCapital) * 2n);
  });

  it('profit split sums correctly for large values', () => {
    const capital = ONE_SOL * 5_000n;
    const result = calculatePnL(1.0, 2.0, capital, capital, 'bonded');

    // cashout + lock should equal total profit (minus rounding)
    const cashPlusLock = result.userCashoutLamports + result.userLockLamports;
    // Due to BigInt floor division, cash+lock <= profit
    expect(cashPlusLock).toBeLessThanOrEqual(result.totalProfitLamports);
    // But very close (within 1 lamport per split operation)
    const diff = result.totalProfitLamports - cashPlusLock;
    expect(diff).toBeLessThanOrEqual(2n);
  });
});

// ──────────────────────────────────────────────
// calculateLivePnLPercent
// ──────────────────────────────────────────────

describe('calculateLivePnLPercent', () => {
  it('multiplies price change by leverage', () => {
    // Price up 10%, 3x leverage → 30% PnL
    const result = calculateLivePnLPercent(1.0, 1.1, 3);
    expect(result).toBeCloseTo(30, 5);
  });

  it('returns negative for price drop with leverage', () => {
    // Price down 10%, 5x leverage → -50% PnL
    const result = calculateLivePnLPercent(1.0, 0.9, 5);
    expect(result).toBeCloseTo(-50, 5);
  });

  it('returns 0 when price is unchanged', () => {
    const result = calculateLivePnLPercent(1.0, 1.0, 7);
    expect(result).toBe(0);
  });

  it('returns raw price change at 1x leverage', () => {
    const result = calculateLivePnLPercent(100, 120, 1);
    expect(result).toBeCloseTo(20, 5);
  });

  it('calculates correctly for large price moves', () => {
    // Price triples (200% change), 2x leverage → 400% PnL
    const result = calculateLivePnLPercent(1.0, 3.0, 2);
    expect(result).toBeCloseTo(400, 5);
  });
});

// ──────────────────────────────────────────────
// calculateMaxLoss
// ──────────────────────────────────────────────

describe('calculateMaxLoss', () => {
  it('sums user capital and flat fee', () => {
    const capital = ONE_SOL;
    const fee = 50_000_000n; // 0.05 SOL
    expect(calculateMaxLoss(capital, fee)).toBe(capital + fee);
  });

  it('returns user capital when fee is zero', () => {
    expect(calculateMaxLoss(ONE_SOL, 0n)).toBe(ONE_SOL);
  });

  it('works with very small values', () => {
    expect(calculateMaxLoss(1n, 1n)).toBe(2n);
  });
});

// ──────────────────────────────────────────────
// generateScenarios
// ──────────────────────────────────────────────

describe('generateScenarios', () => {
  const userCap = ONE_SOL;
  const protoCap = 2n * ONE_SOL; // 3x total

  it('2x scenario: profit = total capital (100% gain)', () => {
    const scenarios = generateScenarios(userCap, protoCap, 'degen');
    const totalCapital = userCap + protoCap; // 3 SOL

    // 2x means price doubled → profit = totalCapital
    const expectedCash = (totalCapital * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
    const expectedLock = (totalCapital * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

    expect(scenarios.if2x.userCashout).toBe(expectedCash);
    expect(scenarios.if2x.userLock).toBe(expectedLock);
  });

  it('3x scenario: profit = 2 * total capital (200% gain)', () => {
    const scenarios = generateScenarios(userCap, protoCap, 'degen');
    const totalCapital = userCap + protoCap;
    const profit3x = totalCapital * 2n;

    const expectedCash = (profit3x * BigInt(PROFIT_SPLIT.USER_CASH)) / BigInt(BPS.FULL);
    const expectedLock = (profit3x * BigInt(PROFIT_SPLIT.USER_LOCK)) / BigInt(BPS.FULL);

    expect(scenarios.if3x.userCashout).toBe(expectedCash);
    expect(scenarios.if3x.userLock).toBe(expectedLock);
  });

  it('dump scenario: max loss = user capital + flat fee', () => {
    const scenarios = generateScenarios(userCap, protoCap, 'degen');
    const totalCapital = userCap + protoCap;
    // Degen fee = 5% of 3 SOL = 0.15 SOL
    const expectedFee = (totalCapital * 500n) / 10_000n;
    expect(scenarios.ifDump.maxLoss).toBe(userCap + expectedFee);
  });

  it('3x cashout > 2x cashout', () => {
    const scenarios = generateScenarios(userCap, protoCap, 'bonded');
    expect(scenarios.if3x.userCashout).toBeGreaterThan(scenarios.if2x.userCashout);
  });
});
