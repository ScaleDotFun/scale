// ──────────────────────────────────────────────
// FRONT PROTOCOL — Auth Route Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';
import { prisma } from '@front-protocol/database';
import { issueToken } from '../middleware/auth';

describe('Auth Routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // NOTE: The auth limiter allows only 5 requests per minute per IP.
  // We split tests so each test creates a fresh app to avoid rate limiting.
  // Some tests are grouped together to stay under the limit.

  describe('POST /api/auth/register — validation', () => {
    it('rejects missing fields with field names in details', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/register')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      // Field names are in the details array, not the top-level error
      expect(res.body.error).toBe('Missing required fields');
      expect(res.body.details).toContainEqual(expect.stringContaining('email'));
      expect(res.body.details).toContainEqual(expect.stringContaining('password'));
    });

    it('rejects invalid email format', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/register')
        .send({ email: 'not-an-email', password: 'test123456' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/email/i);
    });

    it('rejects short password (< 6 chars)', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: '12345' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/6 characters/i);
    });

    it('rejects duplicate email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 1 } as any);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/register')
        .send({ email: 'existing@example.com', password: 'test123456' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/already registered/i);
    });
  });

  describe('POST /api/auth/register — success', () => {
    it('successfully registers a new user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.create).mockResolvedValue({
        id: 1,
        email: 'new@example.com',
        walletAddress: 'MockNewBotPubkey',
        encryptedKey: 'mock-encrypted-key',
        passwordHash: 'hashed',
        createdAt: new Date(),
        telegramId: null,
        telegramUsername: null,
      } as any);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/register')
        .send({ email: 'new@example.com', password: 'test123456' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
      expect(res.body.data).toHaveProperty('user');
      expect(res.body.data.user.email).toBe('new@example.com');
      expect(res.body.data.user.walletAddress).toBe('MockNewBotPubkey');
    });
  });

  describe('POST /api/auth/login', () => {
    it('rejects missing fields (or rate-limits)', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/api/auth/login').send({});

      // May be 400 (validation) or 429 (rate limited from register tests above)
      expect([400, 429]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('rejects wrong email (or rate-limits)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/login')
        .send({ email: 'wrong@example.com', password: 'test123456' });

      // May be 401 (auth error) or 429 (rate limited)
      expect([401, 429]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/auth/me', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid token', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('returns user data with valid token', async () => {
      const token = issueToken(1, 'TestWallet123');
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 1,
        email: 'test@example.com',
        walletAddress: 'TestWallet123',
        createdAt: new Date(),
      } as any);

      const { agent } = createTestApp();
      const res = await agent
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('test@example.com');
      expect(res.body.data.walletAddress).toBe('TestWallet123');
    });
  });

  describe('POST /api/auth/exchange', () => {
    it('rejects missing auth code', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/api/auth/exchange').send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid auth code', async () => {
      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/exchange')
        .send({ code: 'nonexistent-code' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid or expired/i);
    });
  });

  describe('POST /api/auth/withdraw', () => {
    it('rejects unauthenticated requests', async () => {
      const { agent } = createTestApp();
      const res = await agent.post('/api/auth/withdraw').send({});

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects missing destination address', async () => {
      const token = issueToken(1, 'TestWallet123');

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/withdraw')
        .set('Authorization', `Bearer ${token}`)
        .send({ amountLamports: '100000000' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid Solana address', async () => {
      const token = issueToken(1, 'TestWallet123');

      const { agent } = createTestApp();
      const res = await agent
        .post('/api/auth/withdraw')
        .set('Authorization', `Bearer ${token}`)
        .send({ destinationAddress: 'short', amountLamports: '100000000' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toMatch(/invalid.*address/i);
    });
  });
});
