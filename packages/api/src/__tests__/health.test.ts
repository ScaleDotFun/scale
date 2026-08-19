// ──────────────────────────────────────────────
// SCALE PROTOCOL — Health Check Tests
// ──────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { createTestApp } from './setup';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const { agent } = createTestApp();

    const res = await agent.get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('uptime');
  });
});
