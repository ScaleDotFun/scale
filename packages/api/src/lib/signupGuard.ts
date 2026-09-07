// ──────────────────────────────────────────────
// LOADED PROTOCOL — Sybil resistance for account creation
//
// Stops one person from farming the protocol with many custodial
// accounts (self-dealing to farm creator fees, botting a coin, etc.).
// Layered: a lifetime per-device cap (the strong signal) plus a per-IP
// cap that is WINDOWED rather than lifetime. Carrier-grade NAT puts
// thousands of real mobile users behind a single address, so counting
// every signup ever from an IP would permanently lock out entire
// carriers; a rolling window still stops burst farming.
// All three are tunable via env.
// ──────────────────────────────────────────────

import type { Request } from 'express';
import { prisma } from '@loaded/database';
import { ValidationError } from './errors';

const MAX_PER_DEVICE = Number(process.env.SIGNUP_MAX_PER_DEVICE ?? 1);
const MAX_PER_IP = Number(process.env.SIGNUP_MAX_PER_IP ?? 5);
/** Rolling window for the per-IP cap (default 24h). */
const IP_WINDOW_MS = Number(process.env.SIGNUP_IP_WINDOW_MS ?? 24 * 60 * 60 * 1000);

/**
 * Best-effort real client IP. Behind Vercel→Railway the socket IP is a
 * proxy, so read the left-most X-Forwarded-For entry (the origin client).
 */
export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  const chain = Array.isArray(xff) ? xff.join(',') : (xff ?? '');
  const first = chain.split(',')[0]?.trim();
  return (first || req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 64);
}

/**
 * Stable per-device id — sent by the client as a header (fetch calls)
 * or the `loaded_did` cookie (top-level OAuth navigation). Validated to
 * an opaque token so it can't be used for injection.
 */
export function getDeviceId(req: Request): string | null {
  const header = req.headers['x-device-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromCookie = (req.cookies?.loaded_did as string | undefined) ?? '';
  const id = String(fromHeader || fromCookie || '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : null;
}

export interface SignupIdentity {
  ip: string;
  deviceId: string | null;
}

/**
 * Throw a ValidationError if this IP/device has already hit its cap.
 * Call BEFORE creating the user; pass the same identity to the create.
 */
export async function assertSignupAllowed(id: SignupIdentity): Promise<void> {
  if (id.deviceId && MAX_PER_DEVICE > 0) {
    const count = await prisma.user.count({ where: { deviceId: id.deviceId } });
    if (count >= MAX_PER_DEVICE) {
      throw new ValidationError(
        'An account already exists on this device. Only one account is allowed per device.',
      );
    }
  }

  if (id.ip && id.ip !== 'unknown' && MAX_PER_IP > 0) {
    // Windowed, NOT lifetime. Carrier-grade NAT puts thousands of mobile users
    // behind one address, so counting every signup ever from an IP would
    // permanently lock out an entire carrier once a handful of people joined.
    // The window still stops burst farming; the per-device cap carries the
    // durable sybil signal.
    const since = new Date(Date.now() - IP_WINDOW_MS);
    const count = await prisma.user.count({
      where: { registrationIp: id.ip, createdAt: { gte: since } },
    });
    if (count >= MAX_PER_IP) {
      throw new ValidationError(
        'Too many accounts have been created from this network recently. Please try again later.',
      );
    }
  }
}

export function signupIdentity(req: Request): SignupIdentity {
  return { ip: getClientIp(req), deviceId: getDeviceId(req) };
}
