// ──────────────────────────────────────────────
// SCALE PROTOCOL — Token Listing Verification Tests
//
// POST /tokens/list must accept ONLY genuine pump.fun launches
// (verified via Jupiter's launchpad attribution) and reject everything
// else with actionable errors. Fakes never list; real pump.fun coins
// always do, with the on-chain dev wallet booked as creator.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@scale/database';
import { verifyPumpToken, splTotalSupply } from '@scale/solana';

const TOKEN = 'FsoJx9BdYPFhpVg84truwvBBpVMLtEnCcqYA9duSpump';
const POOL = 'GDfnEsia2WLAW5t8yx2X5j2mkfA74B5675t2kNMaUMPb';
const CREATOR = 'CbUPTbC4K7zdAEWxfa1nad4468xpqDwaBSVbQFVN8rvT';

const JUP_TOKEN = {
  id: TOKEN,
  name: 'Cash Cat',
  symbol: 'CASHCAT',
  icon: 'https://ipfs.io/ipfs/cashcat.png',
  decimals: 6,
  dev: CREATOR,
  launchpad: 'pump.fun',
  graduatedPool: '8sLbNZoA1cfnvMJLPfp98ZLAnFSYCFApfJKMbiXNLwxj',
  mcap: 1_000_000,
  usdPrice: 0.001,
  liquidity: 250_000,
  circSupply: 1_000_000_000,
  totalSupply: 1_000_000_000,
};

describe('POST /tokens/list — pump.fun launch verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROTOCOL_WALLET = POOL;
    vi.mocked(prisma.token.findUnique).mockResolvedValue(null as any);
    vi.mocked(splTotalSupply).mockResolvedValue(10n ** 15n);
  });

  it('rejects an invalid (EVM 0x…) address', async () => {
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: '0x020bfc650a365f8bb26819deaabf3e21291018b4' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/base58/i);
  });

  it('rejects a mint that does not exist on Solana (RPC-level check)', async () => {
    vi.mocked(splTotalSupply).mockRejectedValue(new Error('could not find mint'));
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found on Solana/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a token Jupiter has never seen', async () => {
    vi.mocked(verifyPumpToken).mockResolvedValue({ status: 'not_found' });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found on Solana/i);
    expect(res.body.error).toMatch(/pump\.fun/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a non-pump.fun launch — and names the launchpad it came from', async () => {
    vi.mocked(verifyPumpToken).mockResolvedValue({
      status: 'not_pump_token',
      launchpad: 'Raydium LaunchLab',
      token: { ...JUP_TOKEN, launchpad: 'Raydium LaunchLab' } as any,
    });
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only pump\.fun launches/i);
    expect(res.body.error).toContain('Raydium LaunchLab');
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('lists a verified pump.fun token with the real dev wallet as creator and Jupiter metadata', async () => {
    vi.mocked(verifyPumpToken).mockResolvedValue({
      status: 'verified',
      creator: CREATOR,
      launchpad: 'pump.fun',
      graduated: true,
      token: JUP_TOKEN as any,
    });
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 1, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: JUP_TOKEN.icon,
      creatorWallet: CREATOR, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      symbol: 'CASHCAT',
      feeVerified: true,
      creatorWallet: CREATOR,
      marketCapUsd: 1_000_000,
      liquidityUsd: 250_000,
    });
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({
      creatorWallet: CREATOR,
      name: 'Cash Cat',
      symbol: 'CASHCAT',
      imageUri: JUP_TOKEN.icon,
    });
  });

  it('falls back to the pool wallet as creator when the dev wallet is unknown', async () => {
    vi.mocked(verifyPumpToken).mockResolvedValue({
      status: 'verified',
      creator: undefined,
      launchpad: 'pump.fun',
      graduated: false,
      token: { ...JUP_TOKEN, dev: undefined } as any,
    });
    vi.mocked(prisma.token.create).mockResolvedValue({
      id: 2, address: TOKEN, name: 'Cash Cat', symbol: 'CASHCAT', imageUri: null,
      creatorWallet: POOL, tier: 'degen', listedAt: new Date(),
    } as any);

    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(201);
    expect(vi.mocked(prisma.token.create).mock.calls[0][0].data).toMatchObject({
      creatorWallet: POOL,
    });
  });

  it('rejects a token that is already listed', async () => {
    vi.mocked(prisma.token.findUnique).mockResolvedValue({ id: 1, address: TOKEN } as any);
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already listed/i);
  });
});
