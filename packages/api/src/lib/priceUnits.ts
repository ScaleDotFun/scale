// ──────────────────────────────────────────────
// LOADED PROTOCOL — position price unit conversion
//
// Positions book entryPrice/exitPrice as wei-of-ETH per raw token
// unit (what the swap actually paid). The UI charts in token-USD, so
// the API converts before shipping prices to the frontend:
//   usd = weiPerRaw × 10^decimals ÷ 1e18 × ethUsd
// (× 10^decimals lifts raw units to whole tokens, ÷ 1e18 lifts wei to ETH)
// ──────────────────────────────────────────────

import { erc20Decimals } from '@loaded/evm';
import { fetchEthUsd } from './geckoterminal';

const decimalsCache = new Map<string, number>();

async function decimalsFor(mint: string): Promise<number | null> {
  const hit = decimalsCache.get(mint);
  if (hit !== undefined) return hit;
  try {
    const d = await erc20Decimals(mint);
    decimalsCache.set(mint, d);
    return d;
  } catch {
    return null; // unreadable on-chain — report null rather than guess
  }
}

/**
 * Convert a wei-per-raw-unit position price into token-USD.
 * Returns null when the conversion inputs aren't available — callers
 * must degrade honestly instead of charting a wrong number.
 */
export async function positionPriceToUsd(
  weiPerRawUnit: number | null | undefined,
  tokenMint: string,
): Promise<number | null> {
  const p = Number(weiPerRawUnit);
  if (!Number.isFinite(p) || p <= 0) return null;
  const [decimals, ethUsd] = await Promise.all([
    decimalsFor(tokenMint),
    fetchEthUsd(),
  ]);
  if (decimals == null || ethUsd <= 0) return null;
  return ((p * Math.pow(10, decimals)) / 1e18) * ethUsd;
}
