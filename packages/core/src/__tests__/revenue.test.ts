import { describe, it, expect } from 'vitest';
import { splitRevenue, calculateFullDistribution } from '../revenue.js';
import { LAMPORTS_PER_SOL, REVENUE_SPLIT, BPS } from '../types.js';
import { calculatePnL } from '../pnl.js';

const ONE_SOL = LAMPORTS_PER_SOL;

// ──────────────────────────────────────────────
// splitRevenue
// ──────────────────────────────────────────────

describe('splitRevenue', () => {
  it('splits 30/20/50 correctly for 1 SOL', () => {
    const result = splitRevenue(ONE_SOL);

    // 30% of 1 ETH
    expect(result.creatorPayoutLamports).toBe((ONE_SOL * 30n) / 100n);
    // 20% of 1 ETH
    expect(result.burnAmountLamports).toBe((ONE_SOL * 20n) / 100n);
    // 50% of 1 ETH
    expect(result.poolReturnLamports).toBe((ONE_SOL * 50n) / 100n);
  });

  it('all splits sum to total revenue', () => {
    const total = ONE_SOL * 7n; // 7 SOL
    const result = splitRevenue(total);
    const sum =
      result.creatorPayoutLamports +
      result.burnAmountLamports +
      result.poolReturnLamports;
    expect(sum).toBe(total);
  });

  it('pool absorbs rounding dust', () => {
    // Use an amount that doesn't divide evenly by 10000
    // 33333 lamports:
    //   creator = 33333 * 3000 / 10000 = 9999
    //   burn    = 33333 * 2000 / 10000 = 6666
    //   pool    = 33333 - 9999 - 6666 = 16668
    // Note: 9999 + 6666 + 16668 = 33333 ✓
    const result = splitRevenue(33_333n);
    const sum =
      result.creatorPayoutLamports +
      result.burnAmountLamports +
      result.poolReturnLamports;
    expect(sum).toBe(33_333n);

    // Pool gets slightly more than exact 50% due to rounding
    const exact50 = (33_333n * BigInt(REVENUE_SPLIT.POOL)) / BigInt(BPS.FULL);
    expect(result.poolReturnLamports).toBeGreaterThanOrEqual(exact50);
  });

  it('handles 1 lamport (minimum non-zero)', () => {
    const result = splitRevenue(1n);
    // 1 * 3000/10000 = 0, 1 * 2000/10000 = 0, pool = 1 - 0 - 0 = 1
    expect(result.creatorPayoutLamports).toBe(0n);
    expect(result.burnAmountLamports).toBe(0n);
    expect(result.poolReturnLamports).toBe(1n);
    // Still sums to total
    const sum =
      result.creatorPayoutLamports +
      result.burnAmountLamports +
      result.poolReturnLamports;
    expect(sum).toBe(1n);
  });

  it('handles zero amount', () => {
    const result = splitRevenue(0n);
    expect(result.totalRevenueLamports).toBe(0n);
    expect(result.creatorPayoutLamports).toBe(0n);
    expect(result.burnAmountLamports).toBe(0n);
    expect(result.poolReturnLamports).toBe(0n);
  });

  it('preserves totalRevenueLamports in output', () => {
    const total = 500_000_000n;
    const result = splitRevenue(total);
    expect(result.totalRevenueLamports).toBe(total);
  });

  it('handles large revenue (1000 SOL)', () => {
    const large = ONE_SOL * 1_000n;
    const result = splitRevenue(large);
    expect(result.creatorPayoutLamports).toBe(300n * ONE_SOL);
    expect(result.burnAmountLamports).toBe(200n * ONE_SOL);
    expect(result.poolReturnLamports).toBe(500n * ONE_SOL);
  });
});

// ──────────────────────────────────────────────
// calculateFullDistribution
// ──────────────────────────────────────────────

describe('calculateFullDistribution', () => {
  it('combines PnL and revenue for a profitable position', () => {
    const userCap = ONE_SOL;
    const protoCap = 2n * ONE_SOL;
    const pnl = calculatePnL(1.0, 2.0, userCap, protoCap, 'degen');
    const dist = calculateFullDistribution(pnl, userCap, protoCap);

    // PnL should be passed through
    expect(dist.pnl).toBe(pnl);

    // Revenue should split the flat fee
    expect(dist.revenue.totalRevenueLamports).toBe(pnl.totalProtocolRevenueLamports);
    const revenueSum =
      dist.revenue.creatorPayoutLamports +
      dist.revenue.burnAmountLamports +
      dist.revenue.poolReturnLamports;
    expect(revenueSum).toBe(pnl.totalProtocolRevenueLamports);

    // Capital return — profitable → user gets capital back
    expect(dist.capitalReturn.userCapitalLamports).toBe(userCap);
    expect(dist.capitalReturn.protocolCapitalLamports).toBe(protoCap);
  });

  it('returns 0 user capital on loss', () => {
    const userCap = ONE_SOL;
    const protoCap = 2n * ONE_SOL;
    const pnl = calculatePnL(1.0, 0.5, userCap, protoCap, 'degen');
    const dist = calculateFullDistribution(pnl, userCap, protoCap);

    // Loss → user capital not returned
    expect(dist.capitalReturn.userCapitalLamports).toBe(0n);
    // Protocol always recovers
    expect(dist.capitalReturn.protocolCapitalLamports).toBe(protoCap);
  });

  it('revenue split is independent of profitability', () => {
    const userCap = ONE_SOL;
    const protoCap = ONE_SOL;

    const profitPnl = calculatePnL(1.0, 2.0, userCap, protoCap, 'bonded');
    const lossPnl = calculatePnL(1.0, 0.5, userCap, protoCap, 'bonded');

    const profitDist = calculateFullDistribution(profitPnl, userCap, protoCap);
    const lossDist = calculateFullDistribution(lossPnl, userCap, protoCap);

    // Both have same flat fee (same position size and tier)
    expect(profitDist.revenue.totalRevenueLamports).toBe(
      lossDist.revenue.totalRevenueLamports,
    );
  });
});
