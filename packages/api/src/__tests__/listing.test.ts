// ──────────────────────────────────────────────
// LOADED PROTOCOL — Token Listing Verification Tests
//
// POST /tokens/list enforces the listing deal: the coin must be a genuine
// launchpad token AND its PONS creator fee stream (the creator's share of the
// 1% trade fee) must be pointed at the LOADED pool wallet. The gate reads that
// recipient directly off the coin's bonding curve, so it is contract state
// rather than an inference from transfer history. An unreadable chain is
// 'unverifiable' and must block the listing, never wave it through.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@loaded/database';
import { verifyCreatorFeeShare, erc20TotalSupply, getTokenInfo, isValidAddress } from '@loaded/evm';

const TOKEN = '0x9f2a0c7d54b1e3a86d5f0b17c2e8934ab6d1f705';
const POOL = '0x1f4b7d9e2c6a80351fbb0d47e9c8a2136d5f0e11';

const TOKEN_INFO = {
  address: TOKEN,
  name: 'Cash Cat',
  symbol: 'CASHCAT',
  decimals: 18,
  imageUri: 'https://ipfs.io/ipfs/cashcat.png',
  priceUsd: 0.001,
  marketCap: 1_000_000,
  liquidity: 250_000,
  volume24h: 42_000,
  priceChange24h: 12.5,
  launchpad: 'pons-v2-dex',
};

type Gate = Awaited<ReturnType<typeof verifyCreatorFeeShare>>;

const gate = (over: Partial<Gate>): Gate => ({
  status: 'verified',
  token: TOKEN_INFO,
  launchpad: 'pons-v2-dex',
  poolWallet: POOL,
  graduated: true,
  detail: '4 ERC-20 credit(s) to the pool wallet in blocks 100–50100',
  ...over,
});

describe('POST /tokens/list — PONS creator-fee gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROTOCOL_WALLET = POOL;
    delete process.env.LOADED_VERIFIED_TOKENS;
    delete process.env.LOADED_TOKEN_MINT;
    vi.mocked(isValidAddress).mockImplementation(
      (addr: string) => typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr.trim()),
    );
    vi.mocked(prisma.token.findFirst).mockResolvedValue(null as any);
    vi.mocked(erc20TotalSupply).mockResolvedValue(10n ** 27n);
    vi.mocked(getTokenInfo).mockResolvedValue(TOKEN_INFO as any);
    vi.mocked(verifyCreatorFeeShare).mockResolvedValue(gate({}));
  });

  it('rejects an address that is not a Robinhood Chain 0x address', async () => {
    const { agent } = createTestApp();
    const res = await agent
      .post('/api/tokens/list')
      .send({ tokenAddress: 'GDfnEsia2WLAW5t8yx2X5j2mkfA74B5675t2kNMaUMPb' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/0x/);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a contract that does not exist on Robinhood Chain (RPC-level check)', async () => {
    vi.mocked(erc20TotalSupply).mockRejectedValue(new Error('execution reverted'));
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found on Robinhood Chain/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a coin that never launched on a launchpad', async () => {
    vi.mocked(verifyCreatorFeeShare).mockResolvedValue(
      gate({
        status: 'not_launchpad_token',
        launchpad: null,
        graduated: false,
        detail: 'Only trades on uniswap-v4 — no launchpad pool.',
      }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only PONS launches/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a coin whose PONS creator fees never reach the pool — and says how to fix it', async () => {
    vi.mocked(verifyCreatorFeeShare).mockResolvedValue(
      gate({
        status: 'not_redirected',
        detail: 'no credit to the pool wallet in blocks 100–50100',
      }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not reaching the LOADED pool wallet/i);
    // The instruction must be one a creator can actually follow: the curve's
    // setter is callable only by the PONS factory, so it names the UI field.
    expect(res.body.error).toContain('Creator wallet');
    expect(res.body.error).toContain(POOL);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('refuses to list when the chain could not be read — never a silent pass', async () => {
    vi.mocked(verifyCreatorFeeShare).mockResolvedValue(
      gate({ status: 'unverifiable', detail: 'the chain could not be read over the scan window' }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/try again in a minute/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('refuses to list when the gate itself throws', async () => {
    vi.mocked(verifyCreatorFeeShare).mockRejectedValue(new Error('RPC 502'));
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/could not verify/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('refuses to list while the pool wallet is unconfigured', async () => {
    delete process.env.PROTOCOL_WALLET;
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pool wallet not configured/i);
    expect(verifyCreatorFeeShare).not.toHaveBeenCalled();
  });

  it('lists a coin whose PONS creator fees land in the pool wallet', async () => {
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 1, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: TOKEN_INFO.imageUri,
      creatorWallet: POOL, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(vi.mocked(verifyCreatorFeeShare).mock.calls[0]).toEqual([TOKEN, POOL]);
    expect(res.body.data).toMatchObject({
      symbol: 'CASHCAT',
      feeVerified: true,
      creatorWallet: POOL,
      marketCapUsd: 1_000_000,
      liquidityUsd: 250_000,
    });
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({
      address: TOKEN,
      creatorWallet: POOL,
      name: 'Cash Cat',
      symbol: 'CASHCAT',
      imageUri: TOKEN_INFO.imageUri,
    });
  });

  it('lists a coin with no market data yet, without inventing metadata', async () => {
    vi.mocked(verifyCreatorFeeShare).mockResolvedValue(gate({ token: null, graduated: false }));
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 2, address: TOKEN, name: null, symbol: null, imageUri: null,
      creatorWallet: POOL, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ marketCapUsd: 0, liquidityUsd: 0 });
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({
      name: null,
      symbol: null,
      imageUri: null,
    });
  });

  it('honours the LOADED_VERIFIED_TOKENS admin override, case-insensitively', async () => {
    process.env.LOADED_VERIFIED_TOKENS = ` ${TOKEN.toUpperCase().replace('0X', '0x')} `;
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 3, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: TOKEN_INFO.imageUri,
      creatorWallet: POOL, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data.feeVerified).toBe(true);
    expect(verifyCreatorFeeShare).not.toHaveBeenCalled();
    // Metadata still comes from the market feed, not the caller.
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({
      symbol: 'CASHCAT',
    });
  });

  it('auto-passes $LOADED itself', async () => {
    process.env.LOADED_TOKEN_MINT = TOKEN;
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 4, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: null,
      creatorWallet: POOL, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(verifyCreatorFeeShare).not.toHaveBeenCalled();
  });

  it('rejects a token that is already listed', async () => {
    vi.mocked(prisma.token.findFirst).mockResolvedValue({ id: 1, address: TOKEN } as any);
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already listed/i);
    expect(verifyCreatorFeeShare).not.toHaveBeenCalled();
  });
});
