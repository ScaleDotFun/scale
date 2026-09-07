// ──────────────────────────────────────────────
// LOADED PROTOCOL — Response Helper Tests
// ──────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { sendSuccess, sendError, sendPaginated } from '../lib/response';
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  AppError,
} from '../lib/errors';

/**
 * Create a minimal mock Express Response with chainable .status() and .json().
 */
function createMockRes() {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as any,
    json: vi.fn().mockReturnThis() as any,
  };
  return res as Response;
}

describe('sendSuccess', () => {
  it('returns { success: true, data } with status 200 by default', () => {
    const res = createMockRes();
    sendSuccess(res, { foo: 'bar' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { foo: 'bar' },
    });
  });

  it('accepts a custom status code', () => {
    const res = createMockRes();
    sendSuccess(res, null, 201);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: null,
    });
  });

  it('serializes BigInt values to strings', () => {
    const res = createMockRes();
    sendSuccess(res, { amount: BigInt('1000000000000000000') });

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { amount: '1000000000000000000' },
    });
  });
});

describe('sendError', () => {
  it('handles ValidationError (400) with details', () => {
    const res = createMockRes();
    const err = new ValidationError('Invalid input', ['field is required']);
    sendError(res, err);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Invalid input',
      details: ['field is required'],
    });
  });

  it('handles NotFoundError (404)', () => {
    const res = createMockRes();
    const err = new NotFoundError('Token', 'abc123');
    sendError(res, err);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Token not found: abc123',
    });
  });

  it('handles ForbiddenError (403)', () => {
    const res = createMockRes();
    const err = new ForbiddenError('Access denied');
    sendError(res, err);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Access denied',
    });
  });

  it('handles unknown errors with 500', () => {
    const res = createMockRes();
    // Suppress console.error from sendError internals
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendError(res, new Error('Something broke'));

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.any(String),
      }),
    );
    spy.mockRestore();
  });

  it('handles non-Error values gracefully', () => {
    const res = createMockRes();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendError(res, 'string error');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    spy.mockRestore();
  });
});

describe('sendPaginated', () => {
  it('returns correct pagination shape with hasMore=true', () => {
    const res = createMockRes();
    const data = [{ id: 1 }, { id: 2 }];
    sendPaginated(res, data, 100, 10, 0);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ id: 1 }, { id: 2 }],
      pagination: {
        total: 100,
        limit: 10,
        offset: 0,
        hasMore: true,
      },
    });
  });

  it('returns hasMore=false when at end of results', () => {
    const res = createMockRes();
    sendPaginated(res, [{ id: 5 }], 5, 10, 0);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: expect.objectContaining({ hasMore: false }),
      }),
    );
  });

  it('returns hasMore=false when offset + limit >= total', () => {
    const res = createMockRes();
    sendPaginated(res, [], 50, 10, 50);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        pagination: { total: 50, limit: 10, offset: 50, hasMore: false },
      }),
    );
  });
});
