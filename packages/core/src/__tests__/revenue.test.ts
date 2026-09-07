import { describe, it, expect } from 'vitest';
import { splitRevenue, calculateFullDistribution } from '../revenue.js';
import { WEI_PER_ETH, REVENUE_SPLIT, BPS } from '../types.js';
import { calculatePnL } from '../pnl.js';

const ONE_SOL = WEI_PER_ETH;

// ──────────────────────────────────────────────
// splitRevenue
// ──────────────────────────────────────────────

describe('splitRevenue', () => {
  it('splits 30/20/50 correctly for 1 ETH', () => {
    const result = splitRevenue(ONE_SOL);

    // 30% of 1 ETH
    expect(result.creatorPayoutWei).toBe((ONE_SOL * 30n) / 100n);
    // 20% of 1 ETH
    expect(result.burnAmountWei).toBe((ONE_SOL * 20n) / 100n);
    // 50% of 1 ETH
    expect(result.poolReturnWei).toBe((ONE_SOL * 50n) / 100n);
  });

  it('all splits sum to total revenue', () => {
    const total = ONE_SOL * 7n; // 7 ETH
    const result = splitRevenue(total);
    const sum =
      result.creatorPayoutWei +
      result.burnAmountWei +
      result.poolReturnWei;
    expect(sum).toBe(total);
  });

  it('pool absorbs rounding dust', () => {
    // Use an amount that doesn't divide evenly by 10000
    // 33333 wei:
    //   creator = 33333 * 3000 / 10000 = 9999
    //   burn    = 33333 * 2000 / 10000 = 6666
    //   pool    = 33333 - 9999 - 6666 = 16668
    // Note: 9999 + 6666 + 16668 = 33333 ✓
    const result = splitRevenue(33_333n);
    const sum =
      result.creatorPayoutWei +
      result.burnAmountWei +
      result.poolReturnWei;
    expect(sum).toBe(33_333n);

    // Pool gets slightly more than exact 50% due to rounding
    const exact50 = (33_333n * BigInt(REVENUE_SPLIT.POOL)) / BigInt(BPS.FULL);
    expect(result.poolReturnWei).toBeGreaterThanOrEqual(exact50);
  });

  it('handles 1 wei (minimum non-zero)', () => {
    const result = splitRevenue(1n);
    // 1 * 3000/10000 = 0, 1 * 2000/10000 = 0, pool = 1 - 0 - 0 = 1
    expect(result.creatorPayoutWei).toBe(0n);
    expect(result.burnAmountWei).toBe(0n);
    expect(result.poolReturnWei).toBe(1n);
    // Still sums to total
    const sum =
      result.creatorPayoutWei +
      result.burnAmountWei +
      result.poolReturnWei;
    expect(sum).toBe(1n);
  });

  it('handles zero amount', () => {
    const result = splitRevenue(0n);
    expect(result.totalRevenueWei).toBe(0n);
    expect(result.creatorPayoutWei).toBe(0n);
    expect(result.burnAmountWei).toBe(0n);
    expect(result.poolReturnWei).toBe(0n);
  });

  it('preserves totalRevenueWei in output', () => {
    const total = 500_000_000n;
    const result = splitRevenue(total);
    expect(result.totalRevenueWei).toBe(total);
  });

  it('handles large revenue (1000 ETH)', () => {
    const large = ONE_SOL * 1_000n;
    const result = splitRevenue(large);
    expect(result.creatorPayoutWei).toBe(300n * ONE_SOL);
    expect(result.burnAmountWei).toBe(200n * ONE_SOL);
    expect(result.poolReturnWei).toBe(500n * ONE_SOL);
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
    expect(dist.revenue.totalRevenueWei).toBe(pnl.totalProtocolRevenueWei);
    const revenueSum =
      dist.revenue.creatorPayoutWei +
      dist.revenue.burnAmountWei +
      dist.revenue.poolReturnWei;
    expect(revenueSum).toBe(pnl.totalProtocolRevenueWei);

    // Capital return — profitable → user gets capital back
    expect(dist.capitalReturn.userCapitalWei).toBe(userCap);
    expect(dist.capitalReturn.protocolCapitalWei).toBe(protoCap);
  });

  it('returns 0 user capital on loss', () => {
    const userCap = ONE_SOL;
    const protoCap = 2n * ONE_SOL;
    const pnl = calculatePnL(1.0, 0.5, userCap, protoCap, 'degen');
    const dist = calculateFullDistribution(pnl, userCap, protoCap);

    // Loss → user capital not returned
    expect(dist.capitalReturn.userCapitalWei).toBe(0n);
    // Protocol always recovers
    expect(dist.capitalReturn.protocolCapitalWei).toBe(protoCap);
  });

  it('revenue split is independent of profitability', () => {
    const userCap = ONE_SOL;
    const protoCap = ONE_SOL;

    const profitPnl = calculatePnL(1.0, 2.0, userCap, protoCap, 'bonded');
    const lossPnl = calculatePnL(1.0, 0.5, userCap, protoCap, 'bonded');

    const profitDist = calculateFullDistribution(profitPnl, userCap, protoCap);
    const lossDist = calculateFullDistribution(lossPnl, userCap, protoCap);

    // Both have same flat fee (same position size and tier)
    expect(profitDist.revenue.totalRevenueWei).toBe(
      lossDist.revenue.totalRevenueWei,
    );
  });
});
