// ──────────────────────────────────────────────
// LOADED PROTOCOL — Fee claimer tests
//
// PONS creator fees are claim-based, not push-based: they accrue on the curve,
// a permissionless flush credits a shared escrow vault, and only a claim() sent
// BY the beneficiary turns that credit into ETH. The previous worker assumed
// fees simply landed and never sent a transaction — against a wallet that will
// never move on its own it would have booked nothing, forever.
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
} from '@loaded/evm';
import { feeClaimerWorker } from '../fee-claimer.js';

const WEI = 1_000_000_000_000_000_000n;
const CURVE = '0x1111111111111111111111111111111111111111';
const run = () => (feeClaimerWorker as unknown as { __processor: (j: unknown) => Promise<void> }).__processor({ data: {} });

describe('fee claimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasProtocolKey).mockReturnValue(true);
    vi.mocked(getNativeBalance).mockResolvedValue(WEI / 100n); // 0.01 ETH of gas
    vi.mocked(prisma.token.findMany).mockResolvedValue([
      { id: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'AAA' },
    ] as never);
    vi.mocked(findCurveForToken).mockResolvedValue(CURVE as never);
    vi.mocked(flushCurveFees).mockResolvedValue('0xflush' as never);
    vi.mocked(vaultCreditOf).mockResolvedValue(WEI / 10n); // 0.1 ETH credited
    vi.mocked(claimVaultCredit).mockResolvedValue({ txHash: '0xclaim', received: WEI / 10n } as never);
  });

  it('flushes each listed curve and then claims the vault credit', async () => {
    await run();
    expect(flushCurveFees).toHaveBeenCalledWith(expect.anything(), CURVE);
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
    expect(flushCurveFees).not.toHaveBeenCalled();
    expect(claimVaultCredit).not.toHaveBeenCalled();
    expect(prisma.poolLedger.create).not.toHaveBeenCalled();
  });

  it('does not claim, or book, when only dust is credited', async () => {
    vi.mocked(vaultCreditOf).mockResolvedValue(1n);
    await run();
    expect(claimVaultCredit).not.toHaveBeenCalled();
    expect(prisma.poolLedger.create).not.toHaveBeenCalled();
  });

  it('keeps sweeping when one coin’s flush throws', async () => {
    vi.mocked(prisma.token.findMany).mockResolvedValue([
      { id: 1, address: '0x2222222222222222222222222222222222222222', symbol: 'AAA' },
      { id: 2, address: '0x3333333333333333333333333333333333333333', symbol: 'BBB' },
    ] as never);
    vi.mocked(flushCurveFees).mockRejectedValueOnce(new Error('reverted') as never);
    await run();
    expect(claimVaultCredit).toHaveBeenCalledTimes(1);
  });

  it('never claims without the pool key, however much is credited', async () => {
    vi.mocked(hasProtocolKey).mockReturnValue(false);
    await run();
    expect(claimVaultCredit).not.toHaveBeenCalled();
  });
});
