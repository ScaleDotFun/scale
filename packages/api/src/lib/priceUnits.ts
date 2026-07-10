// ──────────────────────────────────────────────
// SCALE PROTOCOL — position price unit conversion
//
// Positions book entryPrice/exitPrice as wei-of-ETH per raw token unit
// (what the swap actually paid). The UI charts in token-USD from
// GeckoTerminal, so the API converts before shipping prices to the
// frontend:  usd = weiPerRaw × 10^decimals ÷ 1e18 × ethUsd
// ──────────────────────────────────────────────

import { erc20Decimals } from '@scale/evm';
import { fetchEthUsd } from './geckoterminal';

const decimalsCache = new Map<string, number>();

async function decimalsFor(address: string): Promise<number | null> {
  const key = address.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  try {
    const d = await erc20Decimals(address);
    decimalsCache.set(key, d);
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
  tokenAddress: string,
): Promise<number | null> {
  const p = Number(weiPerRawUnit);
  if (!Number.isFinite(p) || p <= 0) return null;
  const [decimals, ethUsd] = await Promise.all([
    decimalsFor(tokenAddress),
    fetchEthUsd(),
  ]);
  if (decimals == null || ethUsd <= 0) return null;
  return ((p * Math.pow(10, decimals)) / 1e18) * ethUsd;
}
