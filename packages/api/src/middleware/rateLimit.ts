// ──────────────────────────────────────────────
// FRONT PROTOCOL — Rate Limiting Middleware
// ──────────────────────────────────────────────

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';

/**
 * Default rate limit: 100 requests per minute per IP.
 * Applied to all routes unless overridden.
 */
export const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

/**
 * Strict rate limit for trading operations: 10 requests per minute per wallet.
 * Applied to position open/close endpoints.
 */
export const tradingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Trading rate limit exceeded. Max 10 operations per minute.',
  },
  keyGenerator: (req: Request) => {
    // Use wallet address if authenticated, fall back to IP
    const authReq = req as AuthenticatedRequest;
    return authReq.wallet || req.ip || req.socket.remoteAddress || 'unknown';
  },
});

/**
 * Generous rate limit for public endpoints: 200 requests per minute per IP.
 * Applied to stats, burns, and other read-only public endpoints.
 */
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});

/**
 * Auth rate limit: 5 requests per minute per IP.
 * Applied to register/login to prevent account creation spam.
 */
export const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many auth attempts. Please try again in a minute.',
  },
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
});
