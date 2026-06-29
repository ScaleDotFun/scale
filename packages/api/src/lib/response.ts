// ──────────────────────────────────────────────
// FRONT PROTOCOL — Response Helpers
// ──────────────────────────────────────────────

import type { Response } from 'express';
import { AppError } from './errors';

/**
 * Recursively convert BigInt values to strings for JSON serialization.
 * This avoids the "BigInt value can't be serialized in JSON" error.
 */
function serializeBigInts(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(serializeBigInts);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}

/**
 * Send a successful JSON response.
 * @param res Express response
 * @param data Response payload
 * @param status HTTP status code (default 200)
 */
export function sendSuccess(res: Response, data: unknown, status: number = 200): void {
  res.status(status).json({
    success: true,
    data: serializeBigInts(data),
  });
}

/**
 * Send an error JSON response.
 * Maps AppError subtypes to their status codes, defaults to 500 for unknown errors.
 */
export function sendError(res: Response, error: unknown): void {
  if (error instanceof AppError) {
    const body: Record<string, unknown> = {
      success: false,
      error: error.message,
    };
    // Include validation details when present
    if ('details' in error && Array.isArray((error as { details: string[] }).details)) {
      body.details = (error as { details: string[] }).details;
    }
    res.status(error.statusCode).json(body);
    return;
  }

  // Unknown errors — don't leak internals
  const message = error instanceof Error ? error.message : 'Internal server error';
  console.error('[API Error]', error);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
  });
}

/**
 * Send a paginated JSON response.
 */
export function sendPaginated(
  res: Response,
  data: unknown[],
  total: number,
  limit: number,
  offset: number,
): void {
  res.status(200).json({
    success: true,
    data: serializeBigInts(data),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  });
}
