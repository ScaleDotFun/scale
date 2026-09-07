// ──────────────────────────────────────────────
// LOADED PROTOCOL — Robinhood Chain price feed for workers
//
// USD prices come from GeckoTerminal (batched per tick). Position entryPrice
// is stored as wei-per-raw-token-unit, so prices are converted into that unit:
//   weiPerRawUnit = (tokenUsd / ethUsd) * 1e18 / 10^decimals
// Token decimals are read once per token and cached in the EVM layer.
// ──────────────────────────────────────────────

import { getUsdPrices, getEthUsd, erc20Decimals } from '@loaded/evm';

export interface TokenPrice {
  /** USD price of one whole token */
  priceUsd: number;
  /** Price in the position ledger's unit: wei of ETH per raw token unit */
  weiPerRawUnit: number;
}

/**
 * Batch-fetch live prices for tokens, in both USD and the wei-per-raw-unit
 * form positions are booked in. Tokens without a price are simply absent from
 * the map — callers skip them rather than trading on a guess.
 */
export async function getTokenPricesEth(
  tokens: string[],
): Promise<Map<string, TokenPrice>> {
  const out = new Map<string, TokenPrice>();
  if (tokens.length === 0) return out;

  const unique = Array.from(new Set(tokens));
  const [prices, ethUsd] = await Promise.all([
    getUsdPrices(unique),
    getEthUsd().catch(() => 0),
  ]);

  // Without an ETH/USD rate the conversion is meaningless — report nothing
  // rather than booking positions against a zero or stale denominator.
  if (!(ethUsd > 0)) return out;

  // getUsdPrices keys by checksummed address; callers may pass any casing.
  const byLower = new Map(
    Array.from(prices.values()).map((p) => [p.address.toLowerCase(), p]),
  );

  for (const token of unique) {
    const p = byLower.get(token.toLowerCase());
    if (!p || !(p.priceUsd > 0)) continue;
    let decimals: number;
    try {
      decimals = await erc20Decimals(token);
    } catch {
      continue; // unreadable token — skip rather than assume 18
    }
    out.set(token, {
      priceUsd: p.priceUsd,
      weiPerRawUnit: ((p.priceUsd / ethUsd) * 1e18) / Math.pow(10, decimals),
    });
  }
  return out;
}
