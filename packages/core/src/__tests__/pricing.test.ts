import { describe, it, expect } from 'vitest';
import {
  determineTier,
  calculateFlatFee,
  isValidLeverage,
  calculateProtocolCapital,
  calculatePositionSize,
  TIER_CONFIGS,
  BLOCKED_LIQUIDITY_THRESHOLD_USD,
} from '../pricing.js';
import { LAMPORTS_PER_SOL } from '../types.js';

// ──────────────────────────────────────────────
// determineTier
// ──────────────────────────────────────────────

describe('determineTier', () => {
  it('returns bonded tier for high-cap bonded token', () => {
    const result = determineTier(2_000_000, 100_000, true);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('bonded');
  });

  it('returns bonded tier at exact minimums', () => {
    const result = determineTier(1_000_000, 50_000, true);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('bonded');
  });

  it('falls through to rising if bonded but market cap too low', () => {
    const result = determineTier(500_000, 50_000, true);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('rising');
  });

  it('falls through to rising if not bonded despite meeting cap/liquidity', () => {
    const result = determineTier(2_000_000, 100_000, false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('rising');
  });

  it('returns rising tier for mid-cap token', () => {
    const result = determineTier(200_000, 15_000, false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('rising');
  });

  it('returns rising tier at exact minimums', () => {
    const result = determineTier(100_000, 10_000, false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('rising');
  });

  it('returns degen tier for low-cap token above liquidity floor', () => {
    const result = determineTier(50_000, 6_000, false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('degen');
  });

  it('returns degen tier at bare minimum liquidity', () => {
    const result = determineTier(0, 5_000, false);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe('degen');
  });

  it('returns null (blocked) when liquidity below threshold', () => {
    const result = determineTier(1_000_000, 4_999, true);
    expect(result).toBeNull();
  });

  it('returns null (blocked) when liquidity is zero', () => {
    const result = determineTier(1_000_000, 0, true);
    expect(result).toBeNull();
  });

  it('returns null (blocked) when liquidity is negative', () => {
    const result = determineTier(1_000_000, -100, true);
    expect(result).toBeNull();
  });

  it('prioritizes bonded over rising when both match', () => {
    // Token qualifies for both bonded and rising
    const result = determineTier(2_000_000, 100_000, true);
    expect(result!.tier).toBe('bonded');
  });

  it('returns degen when bonded but liquidity is too low for bonded/rising', () => {
    // Bonded requires $50K liquidity, rising requires $10K
    const result = determineTier(50_000, 8_000, true);
    expect(result).not.toBeNull();
    // marketCap 50K < rising's 100K, so degen
    expect(result!.tier).toBe('degen');
  });
});

// ──────────────────────────────────────────────
// calculateFlatFee
// ──────────────────────────────────────────────

describe('calculateFlatFee', () => {
  const ONE_SOL = LAMPORTS_PER_SOL;

  it('calculates 2% fee for bonded tier', () => {
    // 1 SOL position → 2% = 0.02 SOL = 20_000_000 lamports
    const fee = calculateFlatFee(ONE_SOL, 'bonded');
    expect(fee).toBe(ONE_SOL * 200n / 10_000n);
    expect(fee).toBe((ONE_SOL * 200n) / 10_000n);
  });

  it('calculates 3% fee for rising tier', () => {
    // 1 SOL position → 3% = 0.03 SOL = 30_000_000 lamports
    const fee = calculateFlatFee(ONE_SOL, 'rising');
    expect(fee).toBe((ONE_SOL * 300n) / 10_000n);
  });

  it('calculates 5% fee for degen tier', () => {
    // 1 SOL position → 5% = 0.05 SOL = 50_000_000 lamports
    const fee = calculateFlatFee(ONE_SOL, 'degen');
    expect(fee).toBe((ONE_SOL * 500n) / 10_000n);
  });

  it('scales correctly with larger position sizes', () => {
    const tenSol = ONE_SOL * 10n;
    const fee = calculateFlatFee(tenSol, 'bonded');
    // 10 SOL * 2% = 0.2 SOL
    expect(fee).toBe((ONE_SOL * 10n * 200n) / 10_000n);
  });

  it('handles very small amounts with BigInt floor division', () => {
    // 100 lamports at 2% → 100 * 200 / 10000 = 2
    const fee = calculateFlatFee(100n, 'bonded');
    expect(fee).toBe(2n);
  });

  it('returns 0 for zero position size', () => {
    expect(calculateFlatFee(0n, 'bonded')).toBe(0n);
  });

  it('handles position sizes that produce fractional lamports (floor)', () => {
    // 1 lamport at 2% → 1 * 200 / 10000 = 0 (floor)
    const fee = calculateFlatFee(1n, 'bonded');
    expect(fee).toBe(0n);
  });
});

// ──────────────────────────────────────────────
// isValidLeverage
// ──────────────────────────────────────────────

describe('isValidLeverage', () => {
  describe('bonded tier (max 7x)', () => {
    it('accepts leverage of 1', () => {
      expect(isValidLeverage(1, 'bonded')).toBe(true);
    });

    it('accepts max leverage of 7', () => {
      expect(isValidLeverage(7, 'bonded')).toBe(true);
    });

    it('rejects leverage of 8 (above max)', () => {
      expect(isValidLeverage(8, 'bonded')).toBe(false);
    });

    it('rejects leverage of 0', () => {
      expect(isValidLeverage(0, 'bonded')).toBe(false);
    });

    it('rejects fractional leverage (2.5)', () => {
      expect(isValidLeverage(2.5, 'bonded')).toBe(false);
    });

    it('rejects negative leverage', () => {
      expect(isValidLeverage(-1, 'bonded')).toBe(false);
    });
  });

  describe('rising tier (max 5x)', () => {
    it('accepts leverage at max (5)', () => {
      expect(isValidLeverage(5, 'rising')).toBe(true);
    });

    it('rejects leverage above max (6)', () => {
      expect(isValidLeverage(6, 'rising')).toBe(false);
    });
  });

  describe('degen tier (max 3x)', () => {
    it('accepts leverage at max (3)', () => {
      expect(isValidLeverage(3, 'degen')).toBe(true);
    });

    it('rejects leverage above max (4)', () => {
      expect(isValidLeverage(4, 'degen')).toBe(false);
    });

    it('accepts minimum leverage (1)', () => {
      expect(isValidLeverage(1, 'degen')).toBe(true);
    });
  });
});

// ──────────────────────────────────────────────
// calculateProtocolCapital
// ──────────────────────────────────────────────

describe('calculateProtocolCapital', () => {
  const ONE_SOL = LAMPORTS_PER_SOL;

  it('calculates protocol capital at 3x leverage', () => {
    // 1 SOL at 3x → protocol provides 2 SOL
    const result = calculateProtocolCapital(ONE_SOL, 3);
    expect(result).toBe(ONE_SOL * 2n);
  });

  it('returns 0 protocol capital at 1x leverage (no leverage)', () => {
    const result = calculateProtocolCapital(ONE_SOL, 1);
    expect(result).toBe(0n);
  });

  it('calculates correctly at max bonded leverage (7x)', () => {
    // 1 SOL at 7x → protocol provides 6 SOL
    const result = calculateProtocolCapital(ONE_SOL, 7);
    expect(result).toBe(ONE_SOL * 6n);
  });

  it('handles large user capital values', () => {
    const tenSol = ONE_SOL * 10n;
    // 10 SOL at 5x → protocol provides 40 SOL
    const result = calculateProtocolCapital(tenSol, 5);
    expect(result).toBe(tenSol * 4n);
  });
});

// ──────────────────────────────────────────────
// calculatePositionSize
// ──────────────────────────────────────────────

describe('calculatePositionSize', () => {
  const ONE_SOL = LAMPORTS_PER_SOL;

  it('calculates total position size at 3x leverage', () => {
    const result = calculatePositionSize(ONE_SOL, 3);
    expect(result).toBe(ONE_SOL * 3n);
  });

  it('returns user capital at 1x leverage', () => {
    const result = calculatePositionSize(ONE_SOL, 1);
    expect(result).toBe(ONE_SOL);
  });

  it('position size = user capital + protocol capital', () => {
    const userCap = ONE_SOL * 2n;
    const leverage = 5;
    const posSize = calculatePositionSize(userCap, leverage);
    const protoCap = calculateProtocolCapital(userCap, leverage);
    expect(posSize).toBe(userCap + protoCap);
  });
});
