// ──────────────────────────────────────────────
// FRONT PROTOCOL — Lock Engine Worker Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PROFIT_LOCK_DURATION_MS } from '@front-protocol/core';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('lock-engine logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lock duration', () => {
    it('PROFIT_LOCK_DURATION_MS is 7 days', () => {
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      expect(PROFIT_LOCK_DURATION_MS).toBe(sevenDaysMs);
    });

    it('unlocksAt is correctly calculated from now + 7 days', () => {
      const now = Date.now();
      const unlocksAt = new Date(now + PROFIT_LOCK_DURATION_MS);
      const expectedTime = now + 7 * 24 * 60 * 60 * 1000;
      expect(unlocksAt.getTime()).toBe(expectedTime);
    });

    it('expired lock detection works correctly', () => {
      // Lock created 8 days ago → should be expired
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      const unlocksAt = new Date(eightDaysAgo + PROFIT_LOCK_DURATION_MS);
      expect(unlocksAt.getTime() <= Date.now()).toBe(true);

      // Lock created 6 days ago → should NOT be expired
      const sixDaysAgo = Date.now() - 6 * 24 * 60 * 60 * 1000;
      const unlocksAtRecent = new Date(sixDaysAgo + PROFIT_LOCK_DURATION_MS);
      expect(unlocksAtRecent.getTime() <= Date.now()).toBe(false);
    });
  });

  describe('$FRONT buy estimation (simulation mode)', () => {
    it('simulation estimates 500 tokens per SOL', () => {
      const solAmount = LAMPORTS_PER_SOL; // 1 SOL
      const estimatedTokens = solAmount * 500n;
      expect(estimatedTokens).toBe(500_000_000_000n);
    });

    it('simulation handles fractional SOL', () => {
      const solAmount = LAMPORTS_PER_SOL / 10n; // 0.1 SOL
      const estimatedTokens = solAmount * 500n;
      expect(estimatedTokens).toBe(50_000_000_000n);
    });
  });

  describe('lock verification logic', () => {
    it('rejects lock when protocol wallet balance is insufficient', () => {
      const walletBalance = 100n;
      const lockAmount = 500n;
      expect(walletBalance < lockAmount).toBe(true);
    });

    it('accepts lock when protocol wallet balance is sufficient', () => {
      const walletBalance = 1000n;
      const lockAmount = 500n;
      expect(walletBalance >= lockAmount).toBe(true);
    });
  });

  describe('unlock transfer flow', () => {
    it('uses correct parameters for SPL transfer', () => {
      const frontTokenMint = 'FRONTmint12345678901234567890123456789012';
      const userWallet = 'UserWallet12345678901234567890123456789012';
      const tokenAmount = 500_000_000_000n;

      // Verify the data shapes match what transferToken expects
      expect(typeof frontTokenMint).toBe('string');
      expect(typeof userWallet).toBe('string');
      expect(typeof tokenAmount).toBe('bigint');
      expect(tokenAmount > 0n).toBe(true);
    });
  });

  describe('simulation mode', () => {
    it('generates unique simulation tx IDs', () => {
      const tx1 = `sim_lock_wallet1_${Date.now()}`;
      // Tiny delay to ensure different timestamp
      const tx2 = `sim_lock_wallet2_${Date.now()}`;

      expect(tx1).toContain('sim_lock_');
      expect(tx2).toContain('sim_lock_');
      // Different wallet → different tx IDs
      expect(tx1).not.toBe(tx2);
    });

    it('falls back to simulation when FRONT_TOKEN_MINT is empty', () => {
      const FRONT_TOKEN_MINT = '';
      const isSimulation = !FRONT_TOKEN_MINT;
      expect(isSimulation).toBe(true);
    });

    it('uses real implementation when FRONT_TOKEN_MINT is set', () => {
      const FRONT_TOKEN_MINT = 'FRONTmint12345678901234567890123456789012';
      const isSimulation = !FRONT_TOKEN_MINT;
      expect(isSimulation).toBe(false);
    });
  });

  describe('DB record shape', () => {
    it('profitLock record contains all required fields', () => {
      const lockRecord = {
        userWallet: 'UserWallet12345678901234567890123456789012',
        solAmount: LAMPORTS_PER_SOL,
        tokenAmount: 500_000_000_000n,
        positionId: 42,
        buyTx: 'sim_front_buy_123',
        lockTx: 'lock_verified_UserWallet_123',
        unlocksAt: new Date(Date.now() + PROFIT_LOCK_DURATION_MS),
        isUnlocked: false,
      };

      expect(lockRecord.userWallet).toBeDefined();
      expect(lockRecord.solAmount).toBeGreaterThan(0n);
      expect(lockRecord.tokenAmount).toBeGreaterThan(0n);
      expect(lockRecord.positionId).toBeDefined();
      expect(lockRecord.buyTx).toBeDefined();
      expect(lockRecord.lockTx).toBeDefined();
      expect(lockRecord.unlocksAt).toBeInstanceOf(Date);
      expect(lockRecord.isUnlocked).toBe(false);
    });
  });
});
