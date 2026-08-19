// ──────────────────────────────────────────────
// SCALE PROTOCOL — Market Route Tests (Solana / GeckoTerminal)
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';

const MINT = 'FsoJx9BdYPFhpVg84truwvBBpVMLtEnCcqYA9duSpump';

describe('Market Routes (Solana)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/market/trending', () => {
    it('returns an array of tokens from GeckoTerminal', async () => {
      const mock = {
        data: [
          {
            attributes: {
              base_token_price_usd: '0.12',
              reserve_in_usd: '5900000',
              volume_usd: { h24: '39000000' },
              price_change_percentage: { h24: '6.3' },
              market_cap_usd: '122000000',
            },
            relationships: { base_token: { data: { id: `solana_${MINT}` } } },
          },
        ],
        included: [
          { id: `solana_${MINT}`, attributes: { address: MINT, name: 'Cash Cat', symbol: 'CASHCAT', image_url: null } },
        ],
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mock) } as any);

      const { agent } = createTestApp();
      const res = await agent.get('/api/market/trending');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0]).toMatchObject({ symbol: 'CASHCAT', liquidity: 5900000 });
      // base58 mints are case-sensitive — the address must survive untouched
      expect(res.body.data[0].address).toBe(MINT);
    });
  });

  describe('GET /api/market/token/:address — Solana address validation', () => {
    it('rejects a non-base58 address', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/market/token/not-an-address');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid token address/i);
    });

    it('rejects an EVM-style 0x address', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/market/token/0x020bfc650a365f8bb26819deaabf3e21291018b4');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid token address/i);
    });

    it('accepts a valid base58 mint (shape check)', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { attributes: { address: MINT, name: 'Cash Cat', symbol: 'CASHCAT', price_usd: '0.12', decimals: '6', total_supply: '1000000000000000' } }, included: [] }),
      } as any);
      const { agent } = createTestApp();
      const res = await agent.get(`/api/market/token/${MINT}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ symbol: 'CASHCAT' });
    });
  });
});
