// ──────────────────────────────────────────────
// FRONT PROTOCOL — Price Feeds
// ──────────────────────────────────────────────

import type { TokenMarketData } from '@front-protocol/core';

const LOG_PREFIX = '[solana:price]';

/** Jupiter Price API v2 base URL */
const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

/** DexScreener API base URL */
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

/** SOL mint for price reference */
const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10_000;

/** Result from a price lookup */
export interface TokenPrice {
  /** Price in USD */
  priceUsd: number;
  /** Price in SOL */
  priceSol: number;
}

/** Jupiter Price API v2 response shape */
interface JupiterPriceResponse {
  data: Record<
    string,
    {
      id: string;
      type: string;
      price: string;
    } | undefined
  >;
  timeTaken: number;
}

/** DexScreener pair shape (subset we care about) */
interface DexScreenerPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string | null;
  priceNative: string;
  volume: {
    h24: number;
  };
  liquidity: {
    usd: number;
  };
  fdv: number | null;
  marketCap: number | null;
  priceChange: {
    h24: number;
  };
}

interface DexScreenerResponse {
  pairs: DexScreenerPair[] | null;
}

/**
 * Create an AbortSignal that times out after `ms` milliseconds.
 */
function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

/**
 * Fetch the current price of a token in USD and SOL from Jupiter Price API v2.
 *
 * @param tokenMint - The token's mint address
 * @returns Token price, or null if the price could not be fetched
 */
export async function getTokenPrice(
  tokenMint: string,
): Promise<TokenPrice | null> {
  try {
    // Fetch token price and SOL price in parallel
    const url = `${JUPITER_PRICE_API}?ids=${tokenMint},${SOL_MINT}`;
    console.log(`${LOG_PREFIX} Fetching price for ${tokenMint.substring(0, 8)}…`);

    const response = await fetch(url, {
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} Jupiter Price API returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const json = (await response.json()) as JupiterPriceResponse;

    const tokenData = json.data[tokenMint];
    const solData = json.data[SOL_MINT];

    if (!tokenData?.price) {
      console.warn(`${LOG_PREFIX} No price data for ${tokenMint.substring(0, 8)}…`);
      return null;
    }

    const tokenPriceUsd = parseFloat(tokenData.price);
    const solPriceUsd = solData?.price ? parseFloat(solData.price) : 0;

    const priceSol = solPriceUsd > 0 ? tokenPriceUsd / solPriceUsd : 0;

    return {
      priceUsd: tokenPriceUsd,
      priceSol,
    };
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to fetch price for ${tokenMint.substring(0, 8)}…: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Fetch prices for multiple tokens in a single API call.
 *
 * @param mints - Array of token mint addresses
 * @returns Map of mint address → price (entries omitted for tokens without price data)
 */
export async function getMultipleTokenPrices(
  mints: string[],
): Promise<Map<string, TokenPrice>> {
  const result = new Map<string, TokenPrice>();

  if (mints.length === 0) return result;

  try {
    // Include SOL mint to compute SOL-denominated prices
    const allIds = [...new Set([...mints, SOL_MINT])];
    const url = `${JUPITER_PRICE_API}?ids=${allIds.join(',')}`;

    console.log(`${LOG_PREFIX} Batch fetching prices for ${mints.length} tokens`);

    const response = await fetch(url, {
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} Jupiter Price API returned ${response.status}: ${response.statusText}`,
      );
      return result;
    }

    const json = (await response.json()) as JupiterPriceResponse;

    const solData = json.data[SOL_MINT];
    const solPriceUsd = solData?.price ? parseFloat(solData.price) : 0;

    for (const mint of mints) {
      const tokenData = json.data[mint];
      if (!tokenData?.price) continue;

      const tokenPriceUsd = parseFloat(tokenData.price);
      const priceSol = solPriceUsd > 0 ? tokenPriceUsd / solPriceUsd : 0;

      result.set(mint, { priceUsd: tokenPriceUsd, priceSol });
    }

    console.log(
      `${LOG_PREFIX} Batch prices fetched: ${result.size}/${mints.length} tokens resolved`,
    );
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Batch price fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}

/**
 * Fetch full market data for a token. Tries Jupiter first, then falls back to
 * DexScreener for richer data (market cap, liquidity, volume).
 *
 * @param tokenMint - The token's mint address
 * @returns Market data, or null if no data source could provide it
 */
export async function getTokenMarketData(
  tokenMint: string,
): Promise<TokenMarketData | null> {
  console.log(
    `${LOG_PREFIX} Fetching market data for ${tokenMint.substring(0, 8)}…`,
  );

  // Try DexScreener first since it provides richer data
  const dexData = await fetchDexScreenerData(tokenMint);
  if (dexData) return dexData;

  // Fallback to Jupiter Price API (less data, but more reliable for new tokens)
  const jupPrice = await getTokenPrice(tokenMint);
  if (jupPrice) {
    return {
      address: tokenMint,
      priceUsd: jupPrice.priceUsd,
      priceSol: jupPrice.priceSol,
      marketCapUsd: 0,
      liquidityUsd: 0,
      volume24hUsd: 0,
      priceChange24hPct: 0,
      isBonded: false, // Cannot determine from price API alone
    };
  }

  console.warn(
    `${LOG_PREFIX} No market data available for ${tokenMint.substring(0, 8)}…`,
  );
  return null;
}

/**
 * Fetch token data from DexScreener API.
 *
 * @param tokenMint - The token's mint address
 * @returns Token market data, or null on failure
 */
async function fetchDexScreenerData(
  tokenMint: string,
): Promise<TokenMarketData | null> {
  try {
    const url = `${DEXSCREENER_API}/tokens/${tokenMint}`;

    const response = await fetch(url, {
      signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      console.warn(
        `${LOG_PREFIX} DexScreener returned ${response.status} for ${tokenMint.substring(0, 8)}…`,
      );
      return null;
    }

    const json = (await response.json()) as DexScreenerResponse;

    if (!json.pairs || json.pairs.length === 0) {
      return null;
    }

    // Find the best Solana pair (highest liquidity)
    const solanaPairs = json.pairs.filter((p) => p.chainId === 'solana');
    if (solanaPairs.length === 0) return null;

    const bestPair = solanaPairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0]!;

    const priceUsd = bestPair.priceUsd ? parseFloat(bestPair.priceUsd) : 0;
    const priceSol = parseFloat(bestPair.priceNative) || 0;

    // Determine if bonded: tokens on Raydium are bonded (graduated from Pump.fun)
    const isBonded = solanaPairs.some(
      (p) => p.dexId === 'raydium' || p.dexId === 'pumpswap',
    );

    return {
      address: tokenMint,
      priceUsd,
      priceSol,
      marketCapUsd: bestPair.marketCap ?? bestPair.fdv ?? 0,
      liquidityUsd: bestPair.liquidity?.usd ?? 0,
      volume24hUsd: bestPair.volume?.h24 ?? 0,
      priceChange24hPct: bestPair.priceChange?.h24 ?? 0,
      isBonded,
    };
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} DexScreener fetch failed for ${tokenMint.substring(0, 8)}…: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}
