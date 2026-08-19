// ──────────────────────────────────────────────
// SCALE PROTOCOL — position price unit conversion
//
// Positions book entryPrice/exitPrice as lamports-of-SOL per raw token
// unit (what the swap actually paid). The UI charts in token-USD, so
// the API converts before shipping prices to the frontend:
//   usd = lamportsPerRaw × 10^decimals ÷ 1e9 × solUsd
// ──────────────────────────────────────────────

import { splDecimals } from '@scale/solana';
import { fetchSolUsd } from './geckoterminal';

const decimalsCache = new Map<string, number>();

async function decimalsFor(mint: string): Promise<number | null> {
  const hit = decimalsCache.get(mint);
  if (hit !== undefined) return hit;
  try {
    const d = await splDecimals(mint);
    decimalsCache.set(mint, d);
    return d;
  } catch {
    return null; // unreadable on-chain — report null rather than guess
  }
}

/**
 * Convert a lamports-per-raw-unit position price into token-USD.
 * Returns null when the conversion inputs aren't available — callers
 * must degrade honestly instead of charting a wrong number.
 */
export async function positionPriceToUsd(
  lamportsPerRawUnit: number | null | undefined,
  tokenMint: string,
): Promise<number | null> {
  const p = Number(lamportsPerRawUnit);
  if (!Number.isFinite(p) || p <= 0) return null;
  const [decimals, solUsd] = await Promise.all([
    decimalsFor(tokenMint),
    fetchSolUsd(),
  ]);
  if (decimals == null || solUsd <= 0) return null;
  return ((p * Math.pow(10, decimals)) / 1e9) * solUsd;
}
