// ──────────────────────────────────────────────
// FRONT PROTOCOL — Position Route Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@front-protocol/database';
import { issueToken } from '../middleware/auth';

describe('Position Routes', () => {
  const testWallet = 'TestWallet12345678901234567890123456';
  let authToken: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    authToken = issueToken(1, testWallet);
  });

  describe('POST /api/positions/open', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/api/positions/open').send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects missing required fields', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/open')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/missing required fields/i);
    });

    it('rejects missing tokenAddress', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/open')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ userCapitalLamports: '1000000000', leverage: 3 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects when token is not found', async () => {
      vi.mocked(prisma.token.findUnique).mockResolvedValue(null);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/open')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tokenAddress: 'NonexistentToken1234567890123456789',
          userCapitalLamports: '1000000000',
          leverage: 3,
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('rejects inactive tokens', async () => {
      vi.mocked(prisma.token.findUnique).mockResolvedValue({
        id: 1,
        address: 'TestToken1234567890123456789012345678',
        tier: 'bonded',
        isActive: false,
      } as any);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/open')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tokenAddress: 'TestToken1234567890123456789012345678',
          userCapitalLamports: '1000000000',
          leverage: 3,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/not active/i);
    });

    it('rejects duplicate position on same token', async () => {
      vi.mocked(prisma.token.findUnique).mockResolvedValue({
        id: 1,
        address: 'TestToken1234567890123456789012345678',
        tier: 'bonded',
        isActive: true,
      } as any);

      vi.mocked(prisma.position.findFirst).mockResolvedValue({
        id: 99,
        status: 'open',
      } as any);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/open')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          tokenAddress: 'TestToken1234567890123456789012345678',
          userCapitalLamports: '1000000000',
          leverage: 3,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/already have an open position/i);
    });
  });

  describe('POST /api/positions/:id/close', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/api/positions/1/close').send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid position ID', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/abc/close')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid position id/i);
    });

    it('returns 404 for nonexistent position', async () => {
      vi.mocked(prisma.position.findUnique).mockResolvedValue(null);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/999/close')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('rejects closing another users position', async () => {
      vi.mocked(prisma.position.findUnique).mockResolvedValue({
        id: 1,
        userWallet: 'DifferentWalletAddress12345678901234',
        status: 'open',
        entryPrice: 0.001,
        tokensBought: 1000n,
        token: { id: 1, address: 'Token123', name: 'Test', symbol: 'TST' },
      } as any);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/positions/1/close')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/do not own/i);
    });
  });

  describe('GET /api/positions/active', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/positions/active');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns empty array when no open positions', async () => {
      vi.mocked(prisma.position.findMany).mockResolvedValue([]);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/positions/active')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it('returns enriched position data', async () => {
      vi.mocked(prisma.position.findMany).mockResolvedValue([
        {
          id: 1,
          userWallet: testWallet,
          status: 'open',
          userCapital: 1_000_000_000n,
          protocolCapital: 2_000_000_000n,
          leverage: 3,
          flatFee: 30_000_000n,
          tier: 'bonded',
          entryPrice: 0.001,
          exitThreshold: -15,
          tokensBought: 3_000_000_000n,
          openedAt: new Date(Date.now() - 60_000),
          token: {
            address: 'Token123',
            name: 'TestCoin',
            symbol: 'TST',
            tier: 'bonded',
          },
        },
      ] as any);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/positions/active')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(1);
      expect(res.body.data[0].userCapital).toBe('1000000000');
      expect(res.body.data[0].leverage).toBe(3);
      expect(res.body.data[0]).toHaveProperty('timeRemainingMs');
      expect(res.body.data[0].timeRemainingMs).toBeGreaterThan(0);
    });
  });

  describe('GET /api/positions/history', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/positions/history');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns paginated history', async () => {
      vi.mocked(prisma.position.findMany).mockResolvedValue([]);
      vi.mocked(prisma.position.count).mockResolvedValue(0);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/positions/history')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total', 0);
      expect(res.body.pagination).toHaveProperty('limit');
    });

    it('respects limit and offset params', async () => {
      vi.mocked(prisma.position.findMany).mockResolvedValue([]);
      vi.mocked(prisma.position.count).mockResolvedValue(50);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/positions/history?limit=5&offset=10')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(5);
      expect(res.body.pagination.offset).toBe(10);
      expect(res.body.pagination.total).toBe(50);
    });

    it('caps limit at 100', async () => {
      vi.mocked(prisma.position.findMany).mockResolvedValue([]);
      vi.mocked(prisma.position.count).mockResolvedValue(0);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/positions/history?limit=500')
        .set('Authorization', `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
    });
  });
});
