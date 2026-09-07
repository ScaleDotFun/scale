// ──────────────────────────────────────────────
// LOADED PROTOCOL — Market Route Tests (Robinhood Chain / GeckoTerminal)
// ──────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestApp } from './setup';

const MINT = '0xd691863b2583902dc87549f273854c0ce644e49b';

describe('Market Routes (Robinhood Chain)', () => {
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
            // dex matters: the screener only surfaces launchpad coins
            relationships: {
              base_token: { data: { id: `robinhood_${MINT}` } },
              dex: { data: { id: 'pons-v2-dex' } },
            },
          },
        ],
        included: [
          { id: `robinhood_${MINT}`, attributes: { address: MINT, name: 'Cash Cat', symbol: 'CASHCAT', image_url: null } },
        ],
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: () => Promise.resolve(mock) } as any);

      const { agent } = createTestApp();
      const res = await agent.get('/api/market/trending');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data[0]).toMatchObject({ symbol: 'CASHCAT', liquidity: 5900000 });
      // hex addresses must survive untouched
      expect(res.body.data[0].address).toBe(MINT);
    });
  });

  describe('GET /api/market/token/:address — Robinhood Chain address validation', () => {
    it('rejects a non-hex address', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/market/token/not-an-address');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid token address/i);
    });

    it('rejects a malformed address', async () => {
      const { agent } = createTestApp();
      const res = await agent.get('/api/market/token/0xnothex');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/invalid token address/i);
    });

    it('accepts a valid 0x token address', async () => {
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
