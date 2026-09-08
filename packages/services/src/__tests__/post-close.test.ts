// ──────────────────────────────────────────────
// LOADED PROTOCOL — Post-close dispatch tests
//
// These cover the two ways the downstream dispatch quietly lost money:
// double-applying the insurance rate, and never drawing on the fund at all.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import { insuranceFundQueue, burnQueue, lockQueue, creatorPayoutsQueue } from '../queues.js';
import { dispatchPostCloseJobs } from '../post-close.js';

const WEI_PER_ETH = 1_000_000_000_000_000_000n;

const base = {
  positionId: 42,
  burnAmountWei: 0n,
  userLockWei: 0n,
  isProfitable: false,
  userWallet: '0x1111111111111111111111111111111111111111',
  tokenId: 7,
  creatorWallet: '0x2222222222222222222222222222222222222222',
  creatorPayoutWei: 0n,
  flatFeeWei: WEI_PER_ETH / 100n, // 0.01 ETH
};

const jobsOn = (queue: { add: unknown }) => vi.mocked(queue.add as never).mock.calls;

describe('dispatchPostCloseJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fund far below target, pool non-trivial → the rate branch binds.
    vi.mocked(prisma.insuranceFund.aggregate).mockResolvedValue({ _sum: { amount: 0n } } as never);
    vi.mocked(prisma.poolLedger.aggregate).mockResolvedValue({
      _sum: { amount: WEI_PER_ETH * 100n },
    } as never);
  });

  it('enqueues the RAW flat fee for the insurance fund, not a pre-rated deposit', async () => {
    await dispatchPostCloseJobs({ ...base });

    const deposit = jobsOn(insuranceFundQueue).find((c) => (c[1] as { type: string }).type === 'deposit');
    expect(deposit).toBeDefined();
    // The worker applies INSURANCE_DEPOSIT_RATE_BPS itself. Sending it a value
    // that already had the rate applied charged 10% of 10% — the fund accrued
    // at a tenth of its designed rate and could never reach its target.
    expect((deposit![1] as { amountWei: string }).amountWei).toBe(base.flatFeeWei.toString());
  });

  it('draws on the insurance fund when the pool did not recover its capital', async () => {
    await dispatchPostCloseJobs({ ...base, poolShortfallWei: WEI_PER_ETH / 2n });

    const withdrawal = jobsOn(insuranceFundQueue).find(
      (c) => (c[1] as { type: string }).type === 'withdrawal',
    );
    expect(withdrawal).toBeDefined();
    expect((withdrawal![1] as { amountWei: string }).amountWei).toBe((WEI_PER_ETH / 2n).toString());
  });

  it('does not draw on the fund when the pool came out whole', async () => {
    await dispatchPostCloseJobs({ ...base, poolShortfallWei: 0n });
    expect(
      jobsOn(insuranceFundQueue).some((c) => (c[1] as { type: string }).type === 'withdrawal'),
    ).toBe(false);
  });

  it('never throws — a settled position must not be undone by a queue failure', async () => {
    vi.mocked(burnQueue.add as never).mockRejectedValueOnce(new Error('redis down') as never);
    await expect(
      dispatchPostCloseJobs({ ...base, burnAmountWei: 1n }),
    ).resolves.toBeUndefined();
  });

  it('skips the creator payout when there is no creator on record', async () => {
    await dispatchPostCloseJobs({ ...base, creatorPayoutWei: 100n, creatorWallet: null });
    expect(jobsOn(creatorPayoutsQueue)).toHaveLength(0);
  });

  it('only locks profit on a profitable close', async () => {
    await dispatchPostCloseJobs({ ...base, userLockWei: 100n, isProfitable: false });
    expect(jobsOn(lockQueue)).toHaveLength(0);
    vi.clearAllMocks();
    vi.mocked(prisma.insuranceFund.aggregate).mockResolvedValue({ _sum: { amount: 0n } } as never);
    vi.mocked(prisma.poolLedger.aggregate).mockResolvedValue({ _sum: { amount: 0n } } as never);
    await dispatchPostCloseJobs({ ...base, userLockWei: 100n, isProfitable: true });
    expect(jobsOn(lockQueue)).toHaveLength(1);
  });
});
