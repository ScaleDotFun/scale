// ──────────────────────────────────────────────
// SCALE PROTOCOL — Token Listing Verification Tests
//
// POST /tokens/list enforces the listing deal: the coin must be a
// genuine pump.fun launch AND its creator must share creator rewards
// with the SCALE pool wallet (default 100%) via pump.fun's on-chain
// fee-sharing program. Everything else is rejected with actionable
// errors that tell the creator exactly what to fix.
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@scale/database';
import { verifyPumpRewardShare, splTotalSupply } from '@scale/solana';

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

const share = (over: Partial<Awaited<ReturnType<typeof verifyPumpRewardShare>>>) => ({
  status: 'verified' as const,
  walletPct: 100,
  shareholders: [{ address: POOL, pct: 100 }],
  creator: CREATOR,
  graduated: true,
  token: JUP_TOKEN as any,
  ...over,
});

describe('POST /tokens/list — creator-reward share gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROTOCOL_WALLET = POOL;
    delete process.env.SCALE_MIN_FEE_SHARE_PCT;
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

  it('rejects a non-pump.fun launch', async () => {
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(
      share({ status: 'not_pump_token', walletPct: 0, shareholders: [] }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only pump\.fun launches/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a coin with reward sharing never enabled — and says how to fix it', async () => {
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(
      share({ status: 'not_configured', walletPct: 0, shareholders: [] }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Share creator rewards/i);
    expect(res.body.error).toContain(POOL);
    expect(res.body.error).toContain('100%');
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a coin whose sharing config omits the pool wallet', async () => {
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(
      share({
        status: 'not_redirected',
        walletPct: 0,
        shareholders: [{ address: CREATOR, pct: 100 }],
      }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a shareholder/i);
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('rejects a partial share below the bar — and reports the actual percent', async () => {
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(
      share({
        status: 'partial',
        walletPct: 40,
        shareholders: [{ address: POOL, pct: 40 }, { address: CREATOR, pct: 60 }],
      }),
    );
    const { agent } = createTestApp();
    const res = await agent.post('/api/tokens/list').send({ tokenAddress: TOKEN });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('40%');
    expect(res.body.error).toContain('100%');
    expect(prisma.token.create).not.toHaveBeenCalled();
  });

  it('lists a coin sharing 100% to the pool, with the dev wallet as creator', async () => {
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(share({}));
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
    vi.mocked(verifyPumpRewardShare).mockResolvedValue(
      share({ creator: undefined, token: { ...JUP_TOKEN, dev: undefined } as any }),
    );
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
