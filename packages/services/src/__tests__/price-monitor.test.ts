// ──────────────────────────────────────────────
// FRONT PROTOCOL — Price Monitor Worker Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shouldAutoClose, calculateLivePnLPercent } from '@scale/core';

const LAMPORTS_PER_SOL = 1_000_000_000n;

describe('price-monitor logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('price check threshold evaluation', () => {
    it('triggers close when price drops past exit threshold', () => {
      const entryPrice = 0.001;
      const currentPrice = 0.0005; // 50% drop
      const leverage = 3;
      const exitThresholdBps = -1500; // -15%
      const openedAt = Date.now() - 60_000; // 1 minute ago

      const result = shouldAutoClose(
        entryPrice,
        currentPrice,
        leverage,
        exitThresholdBps,
        openedAt,
      );

      // 50% drop * 3x leverage = -150% leveraged → way past -15%
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toBe('threshold');
    });

    it('does NOT trigger close when price is stable', () => {
      const entryPrice = 0.001;
      const currentPrice = 0.00098; // tiny 2% drop
      const leverage = 2;
      const exitThresholdBps = -1500;
      const openedAt = Date.now() - 60_000;

      const result = shouldAutoClose(
        entryPrice,
        currentPrice,
        leverage,
        exitThresholdBps,
        openedAt,
      );

      // 2% drop * 2x = -4% leveraged → above -15%
      expect(result.shouldClose).toBe(false);
    });

    it('triggers timeout after 24 hours', () => {
      const entryPrice = 0.001;
      const currentPrice = 0.001; // no change
      const leverage = 3;
      const exitThresholdBps = -1500;
      const openedAt = Date.now() - 25 * 60 * 60 * 1000; // 25h ago

      const result = shouldAutoClose(
        entryPrice,
        currentPrice,
        leverage,
        exitThresholdBps,
        openedAt,
      );

      expect(result.shouldClose).toBe(true);
      expect(result.reason).toBe('timeout');
    });

    it('does NOT timeout before 24 hours', () => {
      const entryPrice = 0.001;
      const currentPrice = 0.001;
      const leverage = 3;
      const exitThresholdBps = -1500;
      const openedAt = Date.now() - 23 * 60 * 60 * 1000; // 23h ago

      const result = shouldAutoClose(
        entryPrice,
        currentPrice,
        leverage,
        exitThresholdBps,
        openedAt,
      );

      expect(result.shouldClose).toBe(false);
    });
  });

  describe('live PnL calculation', () => {
    it('calculates positive PnL for price increase', () => {
      const pnl = calculateLivePnLPercent(0.001, 0.0012, 3);
      // 20% price increase * 3x = 60% leveraged PnL
      expect(pnl).toBeCloseTo(60, 0);
    });

    it('calculates negative PnL for price decrease', () => {
      const pnl = calculateLivePnLPercent(0.001, 0.0009, 3);
      // 10% price drop * 3x = -30% leveraged PnL
      expect(pnl).toBeCloseTo(-30, 0);
    });

    it('returns 0 for no price change', () => {
      const pnl = calculateLivePnLPercent(0.001, 0.001, 5);
      expect(pnl).toBe(0);
    });

    it('handles 1x leverage (no amplification)', () => {
      const pnl = calculateLivePnLPercent(0.001, 0.0008, 1);
      // 20% drop * 1x = -20%
      expect(pnl).toBeCloseTo(-20, 0);
    });
  });

  describe('exit threshold conversion', () => {
    it('correctly converts stored % to bps for shouldAutoClose', () => {
      // Position stores exitThreshold as -15.00 (percentage)
      const storedExitThreshold = -15;
      const exitThresholdBps = storedExitThreshold * 100;
      expect(exitThresholdBps).toBe(-1500);
    });

    it('handles degen tier threshold', () => {
      const storedExitThreshold = -30;
      const exitThresholdBps = storedExitThreshold * 100;
      expect(exitThresholdBps).toBe(-3000);
    });
  });

  describe('warning buffer', () => {
    it('warning triggers within 3% of threshold', () => {
      const WARNING_BUFFER_PCT = 3;
      const thresholdPct = -15; // stored as -1500 bps → -15%

      // PnL at -13%: -13 <= -15 + 3 → -13 <= -12 → TRUE (approaching)
      const currentPnlPct = -13;
      const isApproaching = currentPnlPct < 0 && currentPnlPct <= thresholdPct + WARNING_BUFFER_PCT;
      expect(isApproaching).toBe(true);

      // PnL at -10%: -10 <= -12 → FALSE (still safe)
      const safePnl = -10;
      const isSafe = safePnl < 0 && safePnl <= thresholdPct + WARNING_BUFFER_PCT;
      expect(isSafe).toBe(false);
    });
  });
});
