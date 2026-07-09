// ──────────────────────────────────────────────
// SCALE PROTOCOL — Token Listing Verification Tests
//
// POST /tokens/list must accept ONLY tokens whose Noxa creator-fee
// routing genuinely points at the SCALE pool wallet (verified on
// Noxa's own contracts) and reject everything else with actionable
// errors. Fakes never list; legit redirects always do.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@front-protocol/database';
import { verifyNoxaFeeRedirect, erc20TotalSupply } from '@front-protocol/evm';

const TOKEN = '0x020bfc650a365f8bb26819deaabf3e21291018b4';
const POOL = '0x2222222222222222222222222222222222222222';

function mockGtToken() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      data: { attributes: { address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', price_usd: '0.1', decimals: '18', total_supply: '1e27', market_cap_usd: '1000000', total_reserve_in_usd: '250000' } },
      included: [],
    }),
  } as any);
}

describe('POST /tokens/list — on-chain Noxa fee verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROTOCOL_WALLET = POOL;
    vi.mocked(prisma.token.findUnique).mockResolvedValue(null as any);
    vi.mocked(erc20TotalSupply).mockResolvedValue(10n ** 27n);
    mockGtToken();
  });

  it('rejects an invalid (non-EVM) address', async () => {
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: 'So11111111111111111111111111111111111111112' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0x/);
  });

  it('rejects a token that was not launched via Noxa', async () => {
    vi.mocked(verifyNoxaFeeRedirect).mockResolvedValue({
      status: 'not_noxa_token', walletPct: 0, receivers: [], deployer: null,
    });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not launched via Noxa/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects when the creator never configured fee routing', async () => {
    vi.mocked(verifyNoxaFeeRedirect).mockResolvedValue({
      status: 'not_configured', walletPct: 0, receivers: [], deployer: '0xdep',
    });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Fee redirect not set/i);
    expect(res.body.error).toContain(POOL); // tells them exactly where to point it
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects when fees route to someone else — and names the current receiver', async () => {
    vi.mocked(verifyNoxaFeeRedirect).mockResolvedValue({
      status: 'not_redirected', walletPct: 0,
      receivers: [{ address: '0x9c921A0E9d97F58Dbb7865eAa8e2410c9982aa99', pct: 100 }],
      deployer: '0xdep',
    });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('0x9c921A0E9d97F58Dbb7865eAa8e2410c9982aa99');
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a partial redirect below the minimum share', async () => {
    vi.mocked(verifyNoxaFeeRedirect).mockResolvedValue({
      status: 'partial', walletPct: 25,
      receivers: [{ address: POOL, pct: 25 }, { address: '0xother', pct: 75 }],
      deployer: '0xdep',
    });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/25%/);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('lists a token whose fees genuinely route to the pool wallet, with the real deployer as creator', async () => {
    const DEPLOYER = '0xcdfc08A1C1FBaFB355645E5ddC32122e5716cA90';
    vi.mocked(verifyNoxaFeeRedirect).mockResolvedValue({
      status: 'verified', walletPct: 100,
      receivers: [{ address: POOL, pct: 100 }],
      deployer: DEPLOYER,
    });
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 1, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: null,
      creatorWallet: DEPLOYER, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ symbol: 'CASHCAT', feeVerified: true, creatorWallet: DEPLOYER });
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({ creatorWallet: DEPLOYER });
  });

  it('rejects a token that is already listed', async () => {
    vi.mocked(prisma.token.findUnique).mockResolvedValue({ id: 1, address: TOKEN } as any);
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already listed/i);
  });
});
