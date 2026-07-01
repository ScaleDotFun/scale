/**
 * Serialization helpers for Prisma types that can't be JSON-serialized.
 * Prisma Decimal → {rs, es, ...} object, BigInt → cannot serialize.
 * This module provides helpers to safely convert them before sending to clients.
 */

/** Convert any BigInt or Prisma Decimal value to a string */
export function toStr(value: unknown): string {
  if (value === null || value === undefined) return '0';
  return String(value);
}

/** Convert any BigInt or Prisma Decimal value to a number (lossy for BigInt > Number.MAX_SAFE_INTEGER) */
export function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}
