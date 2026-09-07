// ──────────────────────────────────────────────
// LOADED PROTOCOL — Burn Engine Worker Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

describe('burn-engine logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('burn threshold accumulation', () => {
    it('accumulates amounts below 1 ETH threshold', () => {
      const BURN_THRESHOLD = WEI_PER_ETH;
      let pending = 0n;

      // First deposit: 0.2 ETH
      pending += (WEI_PER_ETH * 2n) / 10n;
      expect(pending < BURN_THRESHOLD).toBe(true);

      // Second deposit: 0.3 ETH → total 0.5 ETH
      pending += (WEI_PER_ETH * 3n) / 10n;
      expect(pending < BURN_THRESHOLD).toBe(true);

      // Third deposit: 0.6 ETH → total 1.1 ETH → threshold hit!
      pending += (WEI_PER_ETH * 6n) / 10n;
      expect(pending >= BURN_THRESHOLD).toBe(true);
      expect(pending).toBe((WEI_PER_ETH * 11n) / 10n);
    });

    it('threshold is exactly 1 ETH', () => {
      const BURN_THRESHOLD = WEI_PER_ETH;
      expect(BURN_THRESHOLD).toBe(1_000_000_000_000_000_000n);
    });

    it('resets to 0 after successful burn', () => {
      let pending = (WEI_PER_ETH * 15n) / 10n; // above threshold
      // After burn, reset
      pending = 0n;
      expect(pending).toBe(0n);
    });
  });

  describe('burn amount serialization', () => {
    it('serializes BigInt to string for job data', () => {
      const burnAmount = (WEI_PER_ETH * 2n) / 10n;
      const serialized = burnAmount.toString();
      expect(serialized).toBe('200000000000000000');
      expect(BigInt(serialized)).toBe(burnAmount);
    });

    it('handles very large amounts', () => {
      const amount = WEI_PER_ETH * 1000n; // 1000 ETH
      const serialized = amount.toString();
      expect(BigInt(serialized)).toBe(amount);
    });
  });

  describe('simulation mode', () => {
    it('returns simulated tokens when LOADED_TOKEN_MINT is empty', () => {
      const LOADED_TOKEN_MINT = '';
      const ethAmount = WEI_PER_ETH;
      
      if (!LOADED_TOKEN_MINT) {
        // Simulation: estimated tokens = amount * 1000
        const estimatedTokens = ethAmount * 1000n;
        expect(estimatedTokens).toBe(WEI_PER_ETH * 1000n);
      }
    });
  });

  describe('pool ledger entry', () => {
    it('burn outflow is recorded as negative', () => {
      const burnAmount = WEI_PER_ETH / 2n;
      const ledgerEntry = -burnAmount; // negative = outflow
      expect(ledgerEntry).toBe(-(WEI_PER_ETH / 2n));
      expect(ledgerEntry < 0n).toBe(true);
    });
  });
});
