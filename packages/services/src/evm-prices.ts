// ──────────────────────────────────────────────
// SCALE PROTOCOL — Robinhood Chain price feed for workers
//
// GeckoTerminal simple-price API (no key needed) batched per tick.
// Position entryPrice is stored as wei-per-raw-token-unit, so live
// prices are converted into the same unit:
//   weiPerRawUnit = (tokenUsd / ethUsd) * 1e18 / 10^decimals
// Decimals are read once from Robinhood Chain and cached forever.
// ──────────────────────────────────────────────

import { erc20Decimals, CONTRACTS } from '@scale/evm';

// Paid CoinGecko key → Pro API base (same GT endpoints, ~500 req/min)
function gtBase(): string {
  return (process.env.COINGECKO_API_KEY ?? '').trim()
    ? 'https://pro-api.coingecko.com/api/v3/onchain'
    : 'https://api.geckoterminal.com/api/v2';
}
function gtHeaders(): Record<string, string> {
  const key = (process.env.COINGECKO_API_KEY ?? '').trim();
  return key
    ? { Accept: 'application/json', 'x-cg-pro-api-key': key }
    : { Accept: 'application/json' };
}
const GT_NETWORK = 'robinhood';
const WETH = CONTRACTS.WETH.toLowerCase();

const decimalsCache = new Map<string, number>();

async function decimalsFor(address: string): Promise<number> {
  const key = address.toLowerCase();
  const hit = decimalsCache.get(key);
  if (hit !== undefined) return hit;
  const d = await erc20Decimals(address);
  decimalsCache.set(key, d);
  return d;
}

export interface TokenPrice {
  /** USD price straight from GeckoTerminal */
  priceUsd: number;
  /** Price in the position ledger's unit: wei of ETH per raw token unit */
  weiPerRawUnit: number;
}

/**
 * Batch-fetch live prices for tokens on Robinhood Chain, in both USD
 * and the wei-per-raw-unit form positions are booked in. Tokens GT
 * doesn't know are simply absent from the map — callers skip them.
 */
export async function getTokenPricesEth(
  addresses: string[],
): Promise<Map<string, TokenPrice>> {
  const out = new Map<string, TokenPrice>();
  if (addresses.length === 0) return out;

  const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));

  // GT allows up to 30 addresses per call; always ride WETH along for ETH/USD
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += 29) {
    batches.push([WETH, ...unique.slice(i, i + 29)]);
  }

  const usd = new Map<string, number>();
  for (const batch of batches) {
    const res = await fetch(
      `${gtBase()}/simple/networks/${GT_NETWORK}/token_price/${batch.join(',')}`,
      { headers: gtHeaders() },
    );
    if (!res.ok) throw new Error(`GeckoTerminal ${res.status} on token_price`);
    const json = (await res.json()) as any;
    const prices = json?.data?.attributes?.token_prices ?? {};
    for (const [addr, p] of Object.entries(prices)) {
      const n = parseFloat(String(p));
      if (Number.isFinite(n) && n > 0) usd.set(addr.toLowerCase(), n);
    }
  }

  const ethUsd = usd.get(WETH) ?? 0;
  if (ethUsd <= 0) return out; // can't convert without ETH/USD — report nothing

  for (const addr of unique) {
    const tokenUsd = usd.get(addr);
    if (!tokenUsd) continue;
    let decimals: number;
    try {
      decimals = await decimalsFor(addr);
    } catch {
      continue; // token unreadable on-chain — skip rather than guess
    }
    out.set(addr, {
      priceUsd: tokenUsd,
      weiPerRawUnit: ((tokenUsd / ethUsd) * 1e18) / Math.pow(10, decimals),
    });
  }
  return out;
}

/** ETH/USD spot from the same GT feed. Returns 0 when unavailable. */
export async function getEthUsd(): Promise<number> {
  const res = await fetch(
    `${gtBase()}/simple/networks/${GT_NETWORK}/token_price/${WETH}`,
    { headers: gtHeaders() },
  );
  if (!res.ok) return 0;
  const json = (await res.json()) as any;
  const n = parseFloat(String(json?.data?.attributes?.token_prices?.[WETH] ?? '0'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
