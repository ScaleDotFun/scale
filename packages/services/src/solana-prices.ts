// ──────────────────────────────────────────────
// SCALE PROTOCOL — Solana price feed for workers
//
// Jupiter Price v3 (lite-api.jup.ag, no key needed) batched per tick.
// Position entryPrice is stored as lamports-per-raw-token-unit, so live
// prices are converted into the same unit:
//   lamportsPerRawUnit = (tokenUsd / solUsd) * 1e9 / 10^decimals
// Decimals ride along in the price response — no extra RPC reads.
// Mints are base58 and case-sensitive: never lowercase them.
// ──────────────────────────────────────────────

import { getUsdPrices, getSolUsd, WSOL_MINT } from '@scale/solana';

export interface TokenPrice {
  /** USD price straight from Jupiter */
  priceUsd: number;
  /** Price in the position ledger's unit: lamports of SOL per raw token unit */
  lamportsPerRawUnit: number;
}

/**
 * Batch-fetch live prices for tokens, in both USD and the
 * lamports-per-raw-unit form positions are booked in. Tokens Jupiter
 * doesn't know are simply absent from the map — callers skip them.
 */
export async function getTokenPricesSol(
  mints: string[],
): Promise<Map<string, TokenPrice>> {
  const out = new Map<string, TokenPrice>();
  if (mints.length === 0) return out;

  const unique = Array.from(new Set(mints));
  const [prices, solUsd] = await Promise.all([
    getUsdPrices([WSOL_MINT, ...unique]),
    getSolUsd().catch(() => 0),
  ]);

  const sol = solUsd > 0 ? solUsd : prices.get(WSOL_MINT)?.usdPrice ?? 0;
  if (sol <= 0) return out; // can't convert without SOL/USD — report nothing

  for (const mint of unique) {
    const p = prices.get(mint);
    if (!p || p.usdPrice <= 0) continue;
    out.set(mint, {
      priceUsd: p.usdPrice,
      lamportsPerRawUnit: ((p.usdPrice / sol) * 1e9) / Math.pow(10, p.decimals),
    });
  }
  return out;
}

/** SOL/USD spot. Returns 0 when unavailable. */
export async function getSolUsdPrice(): Promise<number> {
  try {
    return await getSolUsd();
  } catch {
    return 0;
  }
}
