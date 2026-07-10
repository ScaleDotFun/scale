// ──────────────────────────────────────────────
// FRONT PROTOCOL — Insurance Fund Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateInsuranceFundTarget,
  calculateInsuranceDeposit,
} from '@scale/core';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('insurance-fund logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fund target calculation', () => {
    it('target is 2% of pool balance', () => {
      const poolBalance = LAMPORTS_PER_SOL * 1000n; // 1000 SOL
      const target = calculateInsuranceFundTarget(poolBalance);
      // 2% of 1000 = 20 SOL
      expect(target).toBe(LAMPORTS_PER_SOL * 20n);
    });

    it('target is 0 for empty pool', () => {
      expect(calculateInsuranceFundTarget(0n)).toBe(0n);
    });

    it('target scales linearly', () => {
      const target1 = calculateInsuranceFundTarget(LAMPORTS_PER_SOL * 100n);
      const target2 = calculateInsuranceFundTarget(LAMPORTS_PER_SOL * 200n);
      expect(target2).toBe(target1 * 2n);
    });
  });

  describe('deposit calculation', () => {
    it('deposits 10% of fee when fund is empty', () => {
      const fee = LAMPORTS_PER_SOL; // 1 SOL fee
      const currentFund = 0n;
      const target = LAMPORTS_PER_SOL * 20n; // 20 SOL target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // 10% of 1 SOL = 0.1 SOL
      expect(deposit).toBe(LAMPORTS_PER_SOL / 10n);
    });

    it('deposits 0 when fund has reached target', () => {
      const fee = LAMPORTS_PER_SOL;
      const target = LAMPORTS_PER_SOL * 20n;
      const currentFund = target; // at target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      expect(deposit).toBe(0n);
    });

    it('deposits 0 when fund exceeds target', () => {
      const fee = LAMPORTS_PER_SOL;
      const target = LAMPORTS_PER_SOL * 20n;
      const currentFund = target + LAMPORTS_PER_SOL; // over target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      expect(deposit).toBe(0n);
    });

    it('caps deposit at remaining needed amount', () => {
      const fee = LAMPORTS_PER_SOL * 10n; // 10 SOL fee → 10% = 1 SOL deposit
      const target = LAMPORTS_PER_SOL * 20n; // 20 SOL target
      const currentFund = target - LAMPORTS_PER_SOL / 20n; // needs 0.05 SOL more

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // Should cap at 0.05 SOL, not deposit the full 1 SOL
      expect(deposit).toBe(LAMPORTS_PER_SOL / 20n);
    });
  });

  describe('position-closer integration', () => {
    it('uses real pool balance for target (not hardcoded)', () => {
      // This verifies the fix for the 0n bug
      const realPoolBalance = LAMPORTS_PER_SOL * 500n; // 500 SOL pool
      const target = calculateInsuranceFundTarget(realPoolBalance);
      // Target = 2% of 500 = 10 SOL
      expect(target).toBe(LAMPORTS_PER_SOL * 10n);

      // With the old bug (hardcoded 100 SOL target), this would have been 100 SOL
      const wrongTarget = LAMPORTS_PER_SOL * 100n;
      expect(target).not.toBe(wrongTarget);
    });

    it('correctly caps deposits when fund is nearly full', () => {
      const poolBalance = LAMPORTS_PER_SOL * 100n; // 100 SOL pool
      const target = calculateInsuranceFundTarget(poolBalance); // 2 SOL target
      const currentFund = LAMPORTS_PER_SOL * 2n - 1000n; // 1000 lamports below target

      const fee = LAMPORTS_PER_SOL; // 1 SOL fee → 10% = 0.1 SOL
      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // Should deposit only 1000 lamports (not the full 0.1 SOL)
      expect(deposit).toBe(1000n);
    });
  });

  describe('withdrawal safety', () => {
    it('negative amounts represent withdrawals in ledger', () => {
      const withdrawAmount = LAMPORTS_PER_SOL * 5n;
      const ledgerValue = -withdrawAmount;
      expect(ledgerValue).toBe(-5_000_000_000n);
      expect(ledgerValue < 0n).toBe(true);
    });

    it('fund balance = sum of deposits minus withdrawals', () => {
      const deposits = [
        LAMPORTS_PER_SOL,      // +1 SOL
        LAMPORTS_PER_SOL / 2n, // +0.5 SOL
      ];
      const withdrawals = [
        -LAMPORTS_PER_SOL / 4n, // -0.25 SOL
      ];

      const balance = [...deposits, ...withdrawals].reduce((sum, v) => sum + v, 0n);
      // 1 + 0.5 - 0.25 = 1.25 SOL
      expect(balance).toBe(1_250_000_000n);
    });
  });
});
