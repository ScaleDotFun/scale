// ──────────────────────────────────────────────
// LOADED PROTOCOL — Reconciliation sweep tests
//
// The sweep is the safety net for every crash window in the open/close state
// machines, and it had no coverage at all. Both cases below lost real user
// money before they were fixed: writing off funded positions as 'failed' (a
// status nothing ever revisits) and refunding the same collateral twice.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import { hasProtocolKey, transferNative } from '@loaded/evm';
import { reconcileStalePositions } from '../price-monitor.js';

const WEI_PER_ETH = 1_000_000_000_000_000_000n;
const USER = '0x1111111111111111111111111111111111111111';

const openingRow = (over: Record<string, unknown> = {}) => ({
  id: 1,
  userWallet: USER,
  userCapital: WEI_PER_ETH,
  protocolCapital: WEI_PER_ETH * 2n,
  openTx: null,
  collateralTx: null,
  userReturnTx: null,
  token: { address: '0x2222222222222222222222222222222222222222' },
  ...over,
});

describe('reconcileStalePositions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasProtocolKey).mockReturnValue(true);
    // No stale 'closing' rows; the 'opening' query is stubbed per test.
    vi.mocked(prisma.position.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.position.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.position.update).mockResolvedValue({} as never);
  });

  it('does nothing at all when the pool key is missing', async () => {
    vi.mocked(hasProtocolKey).mockReturnValue(false);
    await reconcileStalePositions();
    // Not even a read: a keyless sweep can neither finish nor refund anything,
    // and running anyway fell through to a terminal 'failed' write on rows
    // whose collateral was already sitting in the pool.
    expect(prisma.position.findMany).not.toHaveBeenCalled();
    expect(prisma.position.update).not.toHaveBeenCalled();
  });

  it("marks a row 'failed' only when no marker says funds moved", async () => {
    vi.mocked(prisma.position.findMany)
      .mockResolvedValueOnce([] as never)                 // stale 'closing'
      .mockResolvedValueOnce([openingRow()] as never);    // stale 'opening'

    await reconcileStalePositions();

    const call = vi.mocked(prisma.position.update).mock.calls.at(-1);
    expect((call?.[0] as { data: { status: string } }).data.status).toBe('failed');
    expect(transferNative).not.toHaveBeenCalled();
  });

  it('reserves the refund slot before moving money, and refunds once', async () => {
    vi.mocked(prisma.position.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([openingRow({ collateralTx: '0xabc' })] as never);

    await reconcileStalePositions();

    // The reservation must be a conditional update guarded on userReturnTx
    // being null — transferNative also throws on a confirmation timeout, and
    // the caller only logs "will retry next sweep", so without it the next
    // sweep would pay the same collateral out of the pool a second time.
    const reservation = vi.mocked(prisma.position.updateMany).mock.calls.at(-1);
    expect((reservation?.[0] as { where: Record<string, unknown> }).where).toMatchObject({
      id: 1,
      status: 'opening',
      userReturnTx: null,
    });
    expect(transferNative).toHaveBeenCalledTimes(1);
  });

  it('does not transfer when another worker already holds the reservation', async () => {
    vi.mocked(prisma.position.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([openingRow({ collateralTx: '0xabc' })] as never);
    vi.mocked(prisma.position.updateMany).mockResolvedValue({ count: 0 } as never);

    await reconcileStalePositions();
    expect(transferNative).not.toHaveBeenCalled();
  });

  it('leaves a funded row alone when the refund transfer fails', async () => {
    vi.mocked(prisma.position.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([openingRow({ collateralTx: '0xabc' })] as never);
    vi.mocked(transferNative).mockRejectedValueOnce(new Error('confirmation timeout') as never);

    await reconcileStalePositions();

    // The reservation is deliberately NOT released: the transfer may still
    // land. The row must not be written off either.
    expect(prisma.position.update).not.toHaveBeenCalled();
  });
});
