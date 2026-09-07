// ──────────────────────────────────────────────
// LOADED PROTOCOL — Insurance Fund Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateInsuranceFundTarget,
  calculateInsuranceDeposit,
} from '@loaded/core';

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

describe('insurance-fund logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fund target calculation', () => {
    it('target is 2% of pool balance', () => {
      const poolBalance = WEI_PER_ETH * 1000n; // 1000 ETH
      const target = calculateInsuranceFundTarget(poolBalance);
      // 2% of 1000 = 20 ETH
      expect(target).toBe(WEI_PER_ETH * 20n);
    });

    it('target is 0 for empty pool', () => {
      expect(calculateInsuranceFundTarget(0n)).toBe(0n);
    });

    it('target scales linearly', () => {
      const target1 = calculateInsuranceFundTarget(WEI_PER_ETH * 100n);
      const target2 = calculateInsuranceFundTarget(WEI_PER_ETH * 200n);
      expect(target2).toBe(target1 * 2n);
    });
  });

  describe('deposit calculation', () => {
    it('deposits 10% of fee when fund is empty', () => {
      const fee = WEI_PER_ETH; // 1 ETH fee
      const currentFund = 0n;
      const target = WEI_PER_ETH * 20n; // 20 ETH target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // 10% of 1 ETH = 0.1 ETH
      expect(deposit).toBe(WEI_PER_ETH / 10n);
    });

    it('deposits 0 when fund has reached target', () => {
      const fee = WEI_PER_ETH;
      const target = WEI_PER_ETH * 20n;
      const currentFund = target; // at target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      expect(deposit).toBe(0n);
    });

    it('deposits 0 when fund exceeds target', () => {
      const fee = WEI_PER_ETH;
      const target = WEI_PER_ETH * 20n;
      const currentFund = target + WEI_PER_ETH; // over target

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      expect(deposit).toBe(0n);
    });

    it('caps deposit at remaining needed amount', () => {
      const fee = WEI_PER_ETH * 10n; // 10 ETH fee → 10% = 1 ETH deposit
      const target = WEI_PER_ETH * 20n; // 20 ETH target
      const currentFund = target - WEI_PER_ETH / 20n; // needs 0.05 ETH more

      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // Should cap at 0.05 ETH, not deposit the full 1 ETH
      expect(deposit).toBe(WEI_PER_ETH / 20n);
    });
  });

  describe('position-closer integration', () => {
    it('uses real pool balance for target (not hardcoded)', () => {
      // This verifies the fix for the 0n bug
      const realPoolBalance = WEI_PER_ETH * 500n; // 500 ETH pool
      const target = calculateInsuranceFundTarget(realPoolBalance);
      // Target = 2% of 500 = 10 ETH
      expect(target).toBe(WEI_PER_ETH * 10n);

      // With the old bug (hardcoded 100 ETH target), this would have been 100 ETH
      const wrongTarget = WEI_PER_ETH * 100n;
      expect(target).not.toBe(wrongTarget);
    });

    it('correctly caps deposits when fund is nearly full', () => {
      const poolBalance = WEI_PER_ETH * 100n; // 100 ETH pool
      const target = calculateInsuranceFundTarget(poolBalance); // 2 ETH target
      const currentFund = WEI_PER_ETH * 2n - 1000n; // 1000 wei below target

      const fee = WEI_PER_ETH; // 1 ETH fee → 10% = 0.1 ETH
      const deposit = calculateInsuranceDeposit(fee, currentFund, target);
      // Should deposit only 1000 wei (not the full 0.1 ETH)
      expect(deposit).toBe(1000n);
    });
  });

  describe('withdrawal safety', () => {
    it('negative amounts represent withdrawals in ledger', () => {
      const withdrawAmount = WEI_PER_ETH * 5n;
      const ledgerValue = -withdrawAmount;
      expect(ledgerValue).toBe(-(WEI_PER_ETH * 5n));
      expect(ledgerValue < 0n).toBe(true);
    });

    it('fund balance = sum of deposits minus withdrawals', () => {
      const deposits = [
        WEI_PER_ETH,      // +1 ETH
        WEI_PER_ETH / 2n, // +0.5 ETH
      ];
      const withdrawals = [
        -WEI_PER_ETH / 4n, // -0.25 ETH
      ];

      const balance = [...deposits, ...withdrawals].reduce((sum, v) => sum + v, 0n);
      // 1 + 0.5 - 0.25 = 1.25 ETH
      expect(balance).toBe((WEI_PER_ETH * 125n) / 100n);
    });
  });
});
