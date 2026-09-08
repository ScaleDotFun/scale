// ──────────────────────────────────────────────
// LOADED PROTOCOL — Token discovery tests
// ──────────────────────────────────────────────
//
// Discovery used to run exclusively off a third-party trending feed with a
// $50,000 24h-volume floor. So the protocol could only find a coin that was
// ALREADY popular — and a creator who had redirected their PONS creator fees to
// the pool, which is the entire deal on offer and the only thing that earns the
// protocol anything, was invisible until they got big enough to trend.
//
// Two coins paid the pool for hours without ever appearing on the site. That is
// how this was found, and it is why the chain is now the primary source: the
// fee vault's credit event names the beneficiary and the source curve, so
// scanning it for the pool wallet enumerates exactly who pays us. The money has
// already moved by the time we see it, so the signal cannot be wrong.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  tokensCreditingBeneficiary,
  protocolPublicKey,
  getPublicClient,
  getTrendingTokens,
} from '@loaded/evm';
import { redisConnection } from '../queues.js';
import { checkAndListToken } from '../listing-scanner.js';
import { tokenDiscoveryWorker } from '../token-discovery.js';

vi.mock('../listing-scanner.js', () => ({
  checkAndListToken: vi.fn(() => Promise.resolve(true)),
}));

const POOL = '0xeE0762A780343833434077475A47aC1d77b3030A';
const PAYER = '0x578D881dE70405CeF7e8901d92cb332bFBe578dF';
const HEAD = 57_672_123n;

const run = () =>
  (tokenDiscoveryWorker as unknown as { __processor: (j: unknown) => Promise<void> }).__processor({ data: {} });

describe('token discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(protocolPublicKey).mockReturnValue(POOL as never);
    vi.mocked(getPublicClient).mockReturnValue({ getBlockNumber: async () => HEAD } as never);
    vi.mocked(tokensCreditingBeneficiary).mockResolvedValue([PAYER] as never);
    vi.mocked(getTrendingTokens).mockResolvedValue([] as never);
    vi.mocked(redisConnection.get).mockResolvedValue(null as never);
  });

  it('lists a coin that credited the pool, with no volume anywhere', async () => {
    // The whole point: no trending entry, no volume floor cleared, nothing but
    // a fee credit on-chain — and it still gets listed.
    await run();
    expect(checkAndListToken).toHaveBeenCalledWith(PAYER);
  });

  it('looks back about a day on the first run rather than scanning from genesis', async () => {
    await run();
    const [, from, to] = vi.mocked(tokensCreditingBeneficiary).mock.calls[0] as unknown as [string, bigint, bigint];
    expect(to).toBe(HEAD);
    expect(HEAD - from).toBeGreaterThan(100_000n);
    expect(HEAD - from).toBeLessThan(1_000_000n);
  });

  it('resumes from the saved cursor, overlapping it so a reorg cannot drop a payer', async () => {
    vi.mocked(redisConnection.get).mockResolvedValue('57670000' as never);
    await run();
    const [, from] = vi.mocked(tokensCreditingBeneficiary).mock.calls[0] as unknown as [string, bigint, bigint];
    expect(from).toBeLessThan(57_670_000n);
    expect(from).toBeGreaterThan(57_660_000n);
  });

  it('advances the cursor to the block it actually scanned', async () => {
    await run();
    expect(redisConnection.set).toHaveBeenCalledWith(expect.stringContaining('credit-cursor'), HEAD.toString());
  });

  it('still sweeps trending when the credit scan fails', async () => {
    // A partial answer from the chain costs a delay, not the whole sweep.
    vi.mocked(tokensCreditingBeneficiary).mockRejectedValue(new Error('rpc down') as never);
    vi.mocked(getTrendingTokens).mockResolvedValue([
      { address: '0x1111111111111111111111111111111111111111', launchpad: 'pons-v2', volume24h: 90_000 },
    ] as never);
    await run();
    expect(checkAndListToken).toHaveBeenCalled();
  });

  it('does nothing when the pool wallet is not configured', async () => {
    vi.mocked(protocolPublicKey).mockReturnValue(null as never);
    await run();
    expect(tokensCreditingBeneficiary).not.toHaveBeenCalled();
  });
});
