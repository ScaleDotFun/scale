// ──────────────────────────────────────────────
// FRONT PROTOCOL — Auth Middleware
// ──────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AuthError } from '../lib/errors';
import { sendError } from '../lib/response';

const _jwtSecret = process.env.JWT_SECRET;
if (!_jwtSecret) {
  throw new Error('[auth] JWT_SECRET env var is not set. Required for token signing.');
}
const JWT_SECRET: string = _jwtSecret;
const JWT_EXPIRES_IN = '24h';

/** Telegram bot token — used to verify Telegram auth data */
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

/** Payload stored inside every issued JWT */
export interface JwtPayload {
  userId: number;
  wallet: string;
  iat: number;
  exp: number;
}

/** Extended request with authenticated user */
export interface AuthenticatedRequest extends Request {
  userId?: number;
  wallet?: string;
  telegramId?: string;
}

/**
 * Issue a JWT for an authenticated user.
 * @param userId  Database user ID
 * @param wallet  Solana wallet address (base58)
 * @returns Signed JWT string
 */
export function issueToken(userId: number, wallet: string): string {
  return jwt.sign({ userId, wallet }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * Decode and verify a JWT, returning the payload.
 * Throws AuthError on invalid / expired tokens.
 */
export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    throw new AuthError('Invalid or expired token');
  }
}

/**
 * Middleware: require a valid JWT in the Authorization header.
 * Sets `req.userId` and `req.wallet` on success.
 *
 * Expected header format: `Authorization: Bearer <jwt>`
 */
export function verifyWalletSignature(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthError('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token);
    req.userId = payload.userId;
    req.wallet = payload.wallet;
    next();
  } catch (err) {
    sendError(res, err instanceof AuthError ? err : new AuthError('Authentication failed'));
  }
}

/**
 * Middleware: optionally decode JWT but do NOT reject unauthenticated requests.
 * If a valid token is present, `req.userId` and `req.wallet` are populated;
 * otherwise they stay undefined.
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = verifyToken(token);
      req.userId = payload.userId;
      req.wallet = payload.wallet;
    } catch {
      // Token is invalid — just skip, don't reject
    }
  }
  next();
}

/**
 * Middleware: verify Telegram user via `x-telegram-id` header.
 * For internal bot-to-API calls only. In production the Telegram bot
 * also passes `x-telegram-auth` which is an HMAC of the telegram ID
 * using the bot token as key.
 */
export function verifyTelegramAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  try {
    const telegramId = req.headers['x-telegram-id'] as string | undefined;
    if (!telegramId) {
      throw new AuthError('Missing x-telegram-id header');
    }

    // Basic numeric validation
    const parsed = Number(telegramId);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new AuthError('Invalid Telegram ID');
    }

    // In production, verify HMAC signature
    const authSignature = req.headers['x-telegram-auth'] as string | undefined;
    if (process.env.NODE_ENV === 'production') {
      if (!authSignature) {
        throw new AuthError('Missing x-telegram-auth header');
      }
      // HMAC verification using bot token
      const secretKey = crypto
        .createHash('sha256')
        .update(TELEGRAM_BOT_TOKEN)
        .digest();
      const expectedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(telegramId)
        .digest('hex');
      if (authSignature !== expectedSignature) {
        throw new AuthError('Invalid Telegram auth signature');
      }
    }

    req.telegramId = telegramId;
    next();
  } catch (err) {
    sendError(res, err instanceof AuthError ? err : new AuthError('Telegram authentication failed'));
  }
}
