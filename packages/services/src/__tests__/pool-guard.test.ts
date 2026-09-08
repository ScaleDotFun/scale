// ──────────────────────────────────────────────
// LOADED PROTOCOL — Pool spend guard tests
// ──────────────────────────────────────────────
//
// The open route refuses a user's collateral unless the pool wallet clears the
// reserve its open positions need to be unwound. The burn engine and the lock
// engine spend from that same wallet on their own schedules and used to check
// nothing at all — so a burn at the wrong moment could leave positions that
// were openable and not closeable, stranding a user's collateral in tokens the
// pool has no gas to sell.
//
// Both callers can wait: the burn keeps its pending total in Redis, the lock
// records the debt and buys on the next sweep. So the guard is free to be
// strict, and is: anything it cannot read counts as "no".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import { getNativeBalance, poolReserveFor } from '@loaded/evm';
import { canSpendFromPool } from '../pool-guard.js';

const WEI = 1_000_000_000_000_000_000n;

describe('pool spend guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The real reserve curve: a flat unwind float plus a per-position slice.
    vi.mocked(poolReserveFor).mockImplementation(
      ((n: number) => 3_000_000_000_000_000n + 1_000_000_000_000_000n * BigInt(n)) as never,
    );
    vi.mocked(prisma.position.count).mockResolvedValue(0 as never);
  });

  it('allows a spend the pool can comfortably cover', async () => {
    vi.mocked(getNativeBalance).mockResolvedValue(5n * WEI);
    expect(await canSpendFromPool(WEI)).toMatchObject({ ok: true });
  });

  it('refuses a spend that would eat into the unwind reserve', async () => {
    // 1.002 ETH held, 1 ETH burn — leaves 0.002, under the 0.003 float.
    vi.mocked(getNativeBalance).mockResolvedValue(WEI + 2_000_000_000_000_000n);
    const check = await canSpendFromPool(WEI);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/reserve/);
  });

  it('scales the reserve with the number of open positions', async () => {
    // 1.006 ETH clears the reserve with 2 positions open (needs 1.005) and
    // fails with 10 (needs 1.013). Same balance, same spend, different answer.
    vi.mocked(getNativeBalance).mockResolvedValue(WEI + 6_000_000_000_000_000n);

    vi.mocked(prisma.position.count).mockResolvedValue(2 as never);
    expect((await canSpendFromPool(WEI)).ok).toBe(true);

    vi.mocked(prisma.position.count).mockResolvedValue(10 as never);
    expect((await canSpendFromPool(WEI)).ok).toBe(false);
  });

  it('counts opening and closing positions, not just open ones', async () => {
    vi.mocked(getNativeBalance).mockResolvedValue(5n * WEI);
    await canSpendFromPool(WEI);
    const where = vi.mocked(prisma.position.count).mock.calls[0]?.[0]?.where as {
      status: { in: string[] };
    };
    // Both are unwind obligations: one owes a refund, the other a payout.
    expect(where.status.in).toEqual(expect.arrayContaining(['open', 'opening', 'closing']));
  });

  it('refuses when the pool balance cannot be read', async () => {
    vi.mocked(getNativeBalance).mockRejectedValue(new Error('rpc down') as never);
    const check = await canSpendFromPool(WEI);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/unreadable/);
  });

  it('refuses when the open-position count cannot be read', async () => {
    // Without the count there is no reserve to compare against, and guessing
    // low is how the wallet ends up unable to close what it opened.
    vi.mocked(getNativeBalance).mockResolvedValue(500n * WEI);
    vi.mocked(prisma.position.count).mockRejectedValue(new Error('db down') as never);
    expect((await canSpendFromPool(WEI)).ok).toBe(false);
  });
});
