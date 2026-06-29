// ──────────────────────────────────────────────
// FRONT PROTOCOL — Pump.fun Integration
// ──────────────────────────────────────────────

import { PublicKey } from '@solana/web3.js';
import { getConnection } from './connection.js';

const LOG_PREFIX = '[solana:pumpfun]';

/** Pump.fun public API base URL */
const PUMPFUN_API = 'https://frontend-api-v3.pump.fun';

/** Pump.fun bonding curve program ID */
const PUMPFUN_BONDING_CURVE_PROGRAM = new PublicKey(
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
);

/** PumpSwap AMM program ID */
const PUMPSWAP_AMM_PROGRAM = new PublicKey(
  'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
);

/** Raydium AMM program IDs to check for bonded tokens */
const RAYDIUM_PROGRAMS = [
  new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'), // Raydium AMM v4
  new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C'), // Raydium CPMM
];

/** Request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 10_000;

/** Pump.fun token info returned by their API */
export interface PumpFunTokenInfo {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string;
  metadataUri: string;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  creator: string;
  createdTimestamp: number;
  showName: boolean;
  kingOfTheHillTimestamp: number | null;
  marketCap: number;
  replyCount: number;
  lastReply: number | null;
  nsfw: boolean;
  marketId: string | null;
  inverted: boolean | null;
  usdMarketCap: number;
  /** Whether the token has graduated from bonding curve to Raydium */
  complete: boolean;
  virtualSolReserves: number | null;
  virtualTokenReserves: number | null;
  totalSupply: number | null;
  bondingCurve: string | null;
  associatedBondingCurve: string | null;
  raydiumPool: string | null;
}

/**
 * Fetch token info from the Pump.fun API.
 *
 * @param tokenMint - The token's mint address
 * @returns Token info, or null if not found or not a Pump.fun token
 */
export async function getTokenInfo(
  tokenMint: string,
): Promise<PumpFunTokenInfo | null> {
  try {
    const url = `${PUMPFUN_API}/coins/${tokenMint}`;
    console.log(`${LOG_PREFIX} Fetching token info for ${tokenMint.substring(0, 8)}…`);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });

    if (response.status === 404) {
      console.warn(
        `${LOG_PREFIX} Token ${tokenMint.substring(0, 8)}… not found on Pump.fun`,
      );
      return null;
    }

    if (!response.ok) {
      console.error(
        `${LOG_PREFIX} Pump.fun API returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as PumpFunTokenInfo;

    console.log(
      `${LOG_PREFIX} Token info: ${data.symbol} (${data.name}), creator=${data.creator?.substring(0, 8)}…, complete=${data.complete}`,
    );

    return data;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Failed to fetch token info: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Verify that a token was created by the expected wallet address.
 * Uses the Pump.fun API to look up the creator.
 *
 * @param tokenMint - The token's mint address
 * @param expectedCreator - The expected creator wallet address
 * @returns `true` if the creator matches, `false` otherwise
 */
export async function verifyTokenCreator(
  tokenMint: string,
  expectedCreator: string,
): Promise<boolean> {
  console.log(
    `${LOG_PREFIX} Verifying creator of ${tokenMint.substring(0, 8)}… is ${expectedCreator.substring(0, 8)}…`,
  );

  const info = await getTokenInfo(tokenMint);
  if (!info) {
    console.warn(
      `${LOG_PREFIX} Cannot verify creator — token info unavailable`,
    );
    return false;
  }

  const matches = info.creator === expectedCreator;

  if (matches) {
    console.log(`${LOG_PREFIX} Creator verified ✓`);
  } else {
    console.warn(
      `${LOG_PREFIX} Creator mismatch: expected=${expectedCreator.substring(0, 8)}… actual=${info.creator?.substring(0, 8)}…`,
    );
  }

  return matches;
}

/**
 * Verify that a token's fee account is directed to the expected protocol wallet.
 *
 * This checks on-chain by inspecting the token's metadata or associated accounts
 * to determine if the fee/revenue destination matches the expected wallet.
 *
 * For Pump.fun tokens, this looks at the bonding curve's associated accounts
 * and verifies the fee recipient.
 *
 * @param tokenMint - The token's mint address
 * @param expectedWallet - The expected fee recipient wallet address
 * @returns `true` if fees are directed to the expected wallet
 */
export async function verifyFeeRedirect(
  tokenMint: string,
  expectedWallet: string,
): Promise<boolean> {
  console.log(
    `${LOG_PREFIX} Verifying fee redirect for ${tokenMint.substring(0, 8)}… → ${expectedWallet.substring(0, 8)}…`,
  );

  const connection = getConnection();

  try {
    const mintPubkey = new PublicKey(tokenMint);

    // Derive the bonding curve PDA for this token
    // Pump.fun uses a PDA derived from the program + mint to store the bonding curve state
    const [bondingCurvePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintPubkey.toBuffer()],
      PUMPFUN_BONDING_CURVE_PROGRAM,
    );

    // Fetch the bonding curve account data
    const accountInfo = await connection.getAccountInfo(bondingCurvePda);

    if (!accountInfo) {
      // No bonding curve account — try API fallback
      console.warn(
        `${LOG_PREFIX} No bonding curve PDA found, falling back to API check`,
      );

      const tokenInfo = await getTokenInfo(tokenMint);
      if (!tokenInfo?.bondingCurve) {
        console.warn(
          `${LOG_PREFIX} Cannot verify fee redirect — no bonding curve data`,
        );
        return false;
      }

      // Verify by checking the bonding curve account referenced in the API
      const curveAccountInfo = await connection.getAccountInfo(
        new PublicKey(tokenInfo.bondingCurve),
      );

      if (!curveAccountInfo) {
        console.warn(
          `${LOG_PREFIX} Bonding curve account not found on-chain`,
        );
        return false;
      }

      // The bonding curve data contains the fee recipient
      // Layout: the authority/fee wallet is typically at a known offset
      // For Pump.fun, the fee wallet is embedded in the account data
      if (curveAccountInfo.data.length >= 72) {
        const feeWalletBytes = curveAccountInfo.data.subarray(40, 72);
        const feeWallet = new PublicKey(feeWalletBytes).toBase58();
        const matches = feeWallet === expectedWallet;

        if (matches) {
          console.log(`${LOG_PREFIX} Fee redirect verified ✓`);
        } else {
          console.warn(
            `${LOG_PREFIX} Fee redirect mismatch: expected=${expectedWallet.substring(0, 8)}… actual=${feeWallet.substring(0, 8)}…`,
          );
        }

        return matches;
      }

      console.warn(
        `${LOG_PREFIX} Bonding curve data too short to extract fee wallet`,
      );
      return false;
    }

    // Parse the on-chain bonding curve account data
    if (accountInfo.data.length >= 72) {
      const feeWalletBytes = accountInfo.data.subarray(40, 72);
      const feeWallet = new PublicKey(feeWalletBytes).toBase58();
      const matches = feeWallet === expectedWallet;

      if (matches) {
        console.log(`${LOG_PREFIX} Fee redirect verified ✓`);
      } else {
        console.warn(
          `${LOG_PREFIX} Fee redirect mismatch: expected=${expectedWallet.substring(0, 8)}… actual=${feeWallet.substring(0, 8)}…`,
        );
      }

      return matches;
    }

    console.warn(
      `${LOG_PREFIX} Cannot parse bonding curve data (length=${accountInfo.data.length})`,
    );
    return false;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Fee redirect verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/**
 * Check whether a Pump.fun token has graduated to a DEX (Raydium/PumpSwap).
 *
 * A token is considered "bonded" when it has completed its bonding curve and
 * liquidity has been migrated to Raydium or PumpSwap AMM.
 *
 * Strategy:
 * 1. Check Pump.fun API `complete` flag
 * 2. If API is unavailable, scan on-chain for Raydium/PumpSwap pool accounts
 *
 * @param tokenMint - The token's mint address
 * @returns `true` if the token has graduated (bonded)
 */
export async function isTokenBonded(tokenMint: string): Promise<boolean> {
  console.log(
    `${LOG_PREFIX} Checking if ${tokenMint.substring(0, 8)}… is bonded`,
  );

  // Strategy 1: Check Pump.fun API
  const info = await getTokenInfo(tokenMint);
  if (info) {
    const bonded = info.complete === true || info.raydiumPool !== null;
    console.log(
      `${LOG_PREFIX} Token ${tokenMint.substring(0, 8)}… bonded=${bonded} (API: complete=${info.complete}, raydiumPool=${info.raydiumPool ? 'yes' : 'no'})`,
    );
    return bonded;
  }

  // Strategy 2: On-chain check — look for Raydium/PumpSwap pool
  console.log(
    `${LOG_PREFIX} API unavailable, checking on-chain for DEX pools…`,
  );

  const connection = getConnection();
  const mintPubkey = new PublicKey(tokenMint);

  try {
    // Check for token accounts owned by Raydium or PumpSwap programs
    // If a Raydium/PumpSwap pool exists with this token, it has graduated
    const signatures = await connection.getSignaturesForAddress(
      mintPubkey,
      { limit: 100 },
      'confirmed',
    );

    // Look through recent transactions for interactions with DEX programs
    for (const sig of signatures.slice(0, 20)) {
      try {
        const tx = await connection.getParsedTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.transaction.message.accountKeys) continue;

        const programIds = tx.transaction.message.accountKeys.map((key) =>
          key.pubkey.toBase58(),
        );

        // Check if any Raydium or PumpSwap program was involved
        const dexPrograms = [
          ...RAYDIUM_PROGRAMS.map((p) => p.toBase58()),
          PUMPSWAP_AMM_PROGRAM.toBase58(),
        ];

        if (programIds.some((id) => dexPrograms.includes(id))) {
          console.log(
            `${LOG_PREFIX} Token ${tokenMint.substring(0, 8)}… has DEX pool (found in tx ${sig.signature.substring(0, 16)}…)`,
          );
          return true;
        }
      } catch {
        // Skip individual transaction errors
        continue;
      }
    }

    console.log(
      `${LOG_PREFIX} Token ${tokenMint.substring(0, 8)}… has no DEX pool detected`,
    );
    return false;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} On-chain bonded check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}
