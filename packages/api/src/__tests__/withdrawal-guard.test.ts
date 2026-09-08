// ──────────────────────────────────────────────
// LOADED PROTOCOL — Withdrawal guard tests
// ──────────────────────────────────────────────
//
// The guard used to refuse a withdrawal whenever the user had a position in
// 'open', 'opening' or 'closing'. Two of those three states protect nothing:
// once a position is open the collateral has already left the custodial wallet
// and is sitting in the pool as tokens, so the balance being withheld was never
// committed to anything. And because a row can stick in 'opening' or 'closing'
// after an infrastructure failure, one stuck position froze the user's entire
// wallet with no bound on how long — the worst failure mode a custodial service
// has, in defence of nothing.
//
// What genuinely needs protecting is the seconds-long window where the open
// route has written its intent row and is about to pull the collateral out of
// this wallet. That is the whole scope of the guard now.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import { withdrawalBlockReason, IN_FLIGHT_WINDOW_MS } from '../lib/withdrawalGuard';

const WALLET = '0x1111111111111111111111111111111111111111';

describe('withdrawal guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a withdrawal when nothing is in flight', async () => {
    vi.mocked(prisma.position.count).mockResolvedValue(0 as never);
    expect(await withdrawalBlockReason(WALLET)).toBeNull();
  });

  it('refuses while collateral is being pulled out of the wallet', async () => {
    vi.mocked(prisma.position.count).mockResolvedValue(1 as never);
    const reason = await withdrawalBlockReason(WALLET);
    expect(reason).toMatch(/opening/i);
  });

  it('counts only recent "opening" rows — not open or closing positions', async () => {
    vi.mocked(prisma.position.count).mockResolvedValue(0 as never);
    await withdrawalBlockReason(WALLET);

    const where = vi.mocked(prisma.position.count).mock.calls[0]?.[0]?.where as {
      status: unknown;
      statusChangedAt: { gte: Date };
    };
    // An open position holds none of this wallet's balance; a closing one owes
    // a payout INTO it. Neither is a reason to hold the user's own money.
    expect(where.status).toBe('opening');
    const cutoff = where.statusChangedAt.gte.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(IN_FLIGHT_WINDOW_MS - 5_000);
    expect(Date.now() - cutoff).toBeLessThanOrEqual(IN_FLIGHT_WINDOW_MS + 5_000);
  });

  it('lets go of a row that has been stuck past the in-flight window', async () => {
    // The reconcile sweep owns anything older: it either finishes the position
    // forward or refunds the collateral. Keeping the wallet locked while that
    // happens punishes the user for the protocol's own crash.
    vi.mocked(prisma.position.count).mockImplementation((async (args: {
      where: { statusChangedAt?: { gte: Date } };
    }) => {
      const stuckSince = Date.now() - 3 * IN_FLIGHT_WINDOW_MS;
      const cutoff = args.where.statusChangedAt?.gte.getTime() ?? 0;
      return stuckSince >= cutoff ? 1 : 0;
    }) as never);

    expect(await withdrawalBlockReason(WALLET)).toBeNull();
  });
});
