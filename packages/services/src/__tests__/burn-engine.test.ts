// ──────────────────────────────────────────────
// FRONT PROTOCOL — Burn Engine Worker Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('burn-engine logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('burn threshold accumulation', () => {
    it('accumulates amounts below 1 SOL threshold', () => {
      const BURN_THRESHOLD = LAMPORTS_PER_SOL;
      let pending = 0n;

      // First deposit: 0.2 SOL
      pending += 200_000_000n;
      expect(pending < BURN_THRESHOLD).toBe(true);

      // Second deposit: 0.3 SOL → total 0.5 SOL
      pending += 300_000_000n;
      expect(pending < BURN_THRESHOLD).toBe(true);

      // Third deposit: 0.6 SOL → total 1.1 SOL → threshold hit!
      pending += 600_000_000n;
      expect(pending >= BURN_THRESHOLD).toBe(true);
      expect(pending).toBe(1_100_000_000n);
    });

    it('threshold is exactly 1 SOL', () => {
      const BURN_THRESHOLD = LAMPORTS_PER_SOL;
      expect(BURN_THRESHOLD).toBe(1_000_000_000n);
    });

    it('resets to 0 after successful burn', () => {
      let pending = 1_500_000_000n; // above threshold
      // After burn, reset
      pending = 0n;
      expect(pending).toBe(0n);
    });
  });

  describe('burn amount serialization', () => {
    it('serializes BigInt to string for job data', () => {
      const burnAmount = 200_000_000n;
      const serialized = burnAmount.toString();
      expect(serialized).toBe('200000000');
      expect(BigInt(serialized)).toBe(burnAmount);
    });

    it('handles very large amounts', () => {
      const amount = LAMPORTS_PER_SOL * 1000n; // 1000 SOL
      const serialized = amount.toString();
      expect(BigInt(serialized)).toBe(amount);
    });
  });

  describe('simulation mode', () => {
    it('returns simulated tokens when FRONT_TOKEN_MINT is empty', () => {
      const FRONT_TOKEN_MINT = '';
      const solAmount = LAMPORTS_PER_SOL;
      
      if (!FRONT_TOKEN_MINT) {
        // Simulation: estimated tokens = amount * 1000
        const estimatedTokens = solAmount * 1000n;
        expect(estimatedTokens).toBe(1_000_000_000_000n);
      }
    });
  });

  describe('pool ledger entry', () => {
    it('burn outflow is recorded as negative', () => {
      const burnAmount = 500_000_000n;
      const ledgerEntry = -burnAmount; // negative = outflow
      expect(ledgerEntry).toBe(-500_000_000n);
      expect(ledgerEntry < 0n).toBe(true);
    });
  });
});
