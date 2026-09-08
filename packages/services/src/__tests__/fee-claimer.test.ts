// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee claimer tests
//
// PONS creator fees are claim-based, not push-based: they accrue on the curve,
// a flush moves them into a shared escrow vault as a credit, and only a claim()
// sent BY the beneficiary turns that credit into ETH.
//
// Two mechanics decide the shape of this worker, and both were checked against
// the chain rather than assumed:
//   • claim() pays msg.sender and takes no beneficiary — nobody can collect for
//     us, so the pool wallet must sign its own claim, and needs gas first.
//   • the curve's flush is gated to the fee recipient, the creator and PONS's
//     keeper. For a coin listed with us the pool wallet IS the fee recipient,
//     so flushing on demand is ours to do rather than the keeper's to schedule.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import {
  getNativeBalance,
  hasProtocolKey,
  findCurveForToken,
  flushCurveFees,
  claimVaultCredit,
  vaultCreditOf,
  unwrapWrappedNative,
} from '@loaded/evm';
import { feeClaimerWorker } from '../fee-claimer.js';

const WEI = 1_000_000_000_000_000_000n;
const run = () =>
  (feeClaimerWorker as unknown as { __processor: (j: unknown) => Promise<void> }).__processor({ data: {} });

describe('fee claimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasProtocolKey).mockReturnValue(true);
    vi.mocked(getNativeBalance).mockResolvedValue(WEI / 100n); // 0.01 ETH of gas
    vi.mocked(prisma.token.findMany).mockResolvedValue([
      { id: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'AAA' },
    ] as never);
    vi.mocked(findCurveForToken).mockResolvedValue('0x1111111111111111111111111111111111111111' as never);
    vi.mocked(flushCurveFees).mockResolvedValue('0xflush' as never);
    vi.mocked(vaultCreditOf).mockResolvedValue(WEI / 10n); // 0.1 ETH credited
    vi.mocked(claimVaultCredit).mockResolvedValue({ txHash: '0xclaim', received: WEI / 10n } as never);
    vi.mocked(unwrapWrappedNative).mockResolvedValue(null as never);
    vi.mocked(prisma.poolLedger.findFirst).mockResolvedValue(null as never);
  });

  it('flushes each listed curve, then claims the vault credit', async () => {
    await run();
    expect(flushCurveFees).toHaveBeenCalledTimes(1);
    expect(claimVaultCredit).toHaveBeenCalledTimes(1);
  });

  it('keeps sweeping when one coin flush throws', async () => {
    vi.mocked(prisma.token.findMany).mockResolvedValue([
      { id: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'AAA' },
      { id: 2, address: '0x3333333333333333333333333333333333333333', symbol: 'BBB' },
    ] as never);
    vi.mocked(flushCurveFees).mockRejectedValueOnce(new Error('reverted') as never);
    await run();
    expect(claimVaultCredit).toHaveBeenCalledTimes(1);
  });

  it('books the ETH actually received, not what the vault said was owed', async () => {
    vi.mocked(claimVaultCredit).mockResolvedValue({ txHash: '0xclaim', received: 12345n } as never);
    await run();
    const write = vi.mocked(prisma.poolLedger.create).mock.calls.at(-1);
    expect((write?.[0] as { data: { type: string; amount: bigint } }).data).toMatchObject({
      type: 'fee_claim',
      amount: 12345n,
    });
  });

  it('refuses to run — and stays quiet about spending — when the pool cannot pay gas', async () => {
    vi.mocked(getNativeBalance).mockResolvedValue(0n);
    await run();
    // The chicken-and-egg: claim() pays msg.sender only, so a wallet at zero
    // cannot fund itself. It must not burn its last wei trying.
    expect(claimVaultCredit).not.toHaveBeenCalled();
    expect(prisma.poolLedger.create).not.toHaveBeenCalled();
  });

  it('does not claim, or book, when only dust is credited', async () => {
    vi.mocked(vaultCreditOf).mockResolvedValue(1n);
    await run();
    expect(claimVaultCredit).not.toHaveBeenCalled();
    expect(prisma.poolLedger.create).not.toHaveBeenCalled();
  });

  it('never claims without the pool key, however much is credited', async () => {
    vi.mocked(hasProtocolKey).mockReturnValue(false);
    await run();
    expect(claimVaultCredit).not.toHaveBeenCalled();
  });

  it('does not spend anything before checking it can pay gas', async () => {
    vi.mocked(getNativeBalance).mockResolvedValue(0n);
    await run();
    expect(flushCurveFees).not.toHaveBeenCalled();
  });

  // ── Recovering ETH that is stuck in its wrapped form ──────────
  //
  // Closes route their sell to wrapped native so the proceeds can be read off a
  // Transfer log instead of a balance difference, then unwrap. An unwrap that
  // fails is deliberately NOT allowed to fail the close — the tokens are
  // already sold, and throwing there would send the closer round again to sell
  // tokens the pool no longer holds. The cost of that choice is real pool ETH
  // sitting as WETH while the pool spends native. This sweep is what brings it
  // back, so it has to run before the claim rather than after it.

  it('sweeps stranded wrapped native back to ETH', async () => {
    vi.mocked(unwrapWrappedNative).mockResolvedValue({ txHash: '0xunwrap', amount: WEI / 4n } as never);
    await run();
    expect(unwrapWrappedNative).toHaveBeenCalledTimes(1);
  });

  it('still collects fees when the sweep itself fails', async () => {
    vi.mocked(unwrapWrappedNative).mockRejectedValue(new Error('rpc down') as never);
    await run();
    expect(claimVaultCredit).toHaveBeenCalledTimes(1);
  });

  it('does not try to unwrap before it knows it can pay gas', async () => {
    vi.mocked(getNativeBalance).mockResolvedValue(0n);
    await run();
    expect(unwrapWrappedNative).not.toHaveBeenCalled();
  });

  // ── The ledger row behind an irreversible claim ───────────────

  it('does not rethrow when the ledger write fails — the claim already landed', async () => {
    // A throw here sends BullMQ round again; the retry finds the vault credit
    // gone and books nothing, so the ETH would sit in the wallet with no row
    // behind it and every pool figure derived from the ledger would understate.
    vi.mocked(prisma.poolLedger.create).mockRejectedValue(new Error('db down') as never);
    await expect(run()).resolves.toBeUndefined();
  });

  it('will not book the same claim twice', async () => {
    vi.mocked(prisma.poolLedger.findFirst).mockResolvedValue({ id: 7 } as never);
    await run();
    expect(prisma.poolLedger.create).not.toHaveBeenCalled();
  });
});
