// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee claimer tests
//
// PONS creator fees are claim-based, not push-based: they accrue on the curve,
// PONS's own keeper flushes them into a shared escrow vault as a credit, and
// only a claim() sent BY the beneficiary turns that credit into ETH.
//
// Two mechanics decide the shape of this worker, and both were checked against
// the chain rather than assumed:
//   • claim() pays msg.sender and takes no beneficiary — nobody can collect for
//     us, so the pool wallet must sign its own claim, and needs gas first.
//   • the curve's flush is keeper-gated: calling it from the pool wallet or any
//     other address reverts (0x8d42130c), while PONS's keeper simulates OK.
//     So this worker must NOT try to flush — that half is not ours to do.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@loaded/database';
import {
  getNativeBalance,
  hasProtocolKey,
  claimVaultCredit,
  vaultCreditOf,
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
    vi.mocked(vaultCreditOf).mockResolvedValue(WEI / 10n); // 0.1 ETH credited
    vi.mocked(claimVaultCredit).mockResolvedValue({ txHash: '0xclaim', received: WEI / 10n } as never);
  });

  it('claims the vault credit when the pool has one', async () => {
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

  it('does not read the token list at all — flushing is the keeper’s job, not ours', async () => {
    await run();
    // A flush loop here would send one reverting transaction per listed coin,
    // every sweep, forever. The keeper is gated to 0x49bbf2b7… and we are not it.
    expect(prisma.token.findMany).not.toHaveBeenCalled();
  });
});
