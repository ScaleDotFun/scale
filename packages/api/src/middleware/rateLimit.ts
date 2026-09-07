// ──────────────────────────────────────────────
// LOADED PROTOCOL — Rate Limiting Middleware
// ──────────────────────────────────────────────

import rateLimit from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthenticatedRequest } from './auth';

/** Real client IP behind Vercel→Railway — left-most X-Forwarded-For. */
function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const chain = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
  return (chain.split(',')[0]?.trim() || req.ip || req.socket.remoteAddress || 'unknown');
}

// trust proxy is set intentionally (app.ts) — silence the permissive check
const skipTrustProxyValidation = { validate: { trustProxy: false, xForwardedForHeader: false } };

/**
 * Default rate limit: 100 requests per minute per IP.
 * Applied to all routes unless overridden.
 */
export const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // the terminal legitimately polls several endpoints per second
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  keyGenerator: clientIp,
  ...skipTrustProxyValidation,
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
    // Use wallet address if authenticated, fall back to real client IP
    const authReq = req as AuthenticatedRequest;
    return authReq.wallet || clientIp(req);
  },
  ...skipTrustProxyValidation,
});

/**
 * Generous rate limit for public endpoints: 200 requests per minute per IP.
 * Applied to stats, burns, and other read-only public endpoints.
 */
export const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200, // 1s chart polling + prices + stats: ~5 req/s per active tab is normal
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests, please try again later.',
  },
  keyGenerator: clientIp,
  ...skipTrustProxyValidation,
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
  keyGenerator: clientIp,
  ...skipTrustProxyValidation,
});
