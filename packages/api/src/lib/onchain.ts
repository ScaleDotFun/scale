// ──────────────────────────────────────────────
// SCALE PROTOCOL — On-chain truth for public stats (Robinhood Chain)
//
// The DB ledger is protocol accounting; the chain is reality.
// Public stats report the pool wallet's REAL ETH balance and the
// protocol token's locked supply, read via viem from Robinhood
// Chain (Arbitrum Orbit L2, chain 4663) and cached briefly.
// ──────────────────────────────────────────────

import {
  getEthBalance,
  erc20Balance,
  erc20TotalSupply,
  erc20Decimals,
  getProtocolAccount,
  hasEvmProtocolKey,
} from '@scale/evm';

// The protocol token (ERC-20 on Robinhood Chain), configured per-launch.
// Until it's set, locked-supply stats are honestly null.
const TOKEN_ADDRESS = (process.env.FRONT_TOKEN_MINT ?? '').trim();

/** Wallets whose protocol-token holdings count as "locked supply". */
const LOCKED_WALLETS: string[] = (process.env.FRONT_LOCKED_WALLETS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

export interface OnchainStats {
  /** Real ETH balance of the protocol pool wallet, in wei (string) */
  poolWalletLamports: string;
  /** Pool wallet address — verify on Blockscout */
  poolWalletAddress: string;
  frontLockedTokens: number | null;
  frontTotalSupply: number | null;
  frontLockedPct: number | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
let cache: OnchainStats | null = null;
let inFlight: Promise<OnchainStats | null> | null = null;

async function fetchSnapshot(): Promise<OnchainStats | null> {
  try {
    if (!hasEvmProtocolKey()) {
      // No EVM pool key configured yet — nothing truthful to report.
      return null;
    }
    const wallet = getProtocolAccount().address;
    const balance = await getEthBalance(wallet);

    let frontLockedTokens: number | null = null;
    let frontTotalSupply: number | null = null;
    let frontLockedPct: number | null = null;

    if (/^0x[a-fA-F0-9]{40}$/.test(TOKEN_ADDRESS)) {
      const [supplyRaw, decimals, ...locked] = await Promise.all([
        erc20TotalSupply(TOKEN_ADDRESS),
        erc20Decimals(TOKEN_ADDRESS),
        ...LOCKED_WALLETS.map((w) => erc20Balance(TOKEN_ADDRESS, w).catch(() => 0n)),
      ]);
      const div = Math.pow(10, decimals);
      frontTotalSupply = Number(supplyRaw) / div;
      frontLockedTokens = locked.reduce((a, b) => a + Number(b) / div, 0);
      frontLockedPct = frontTotalSupply > 0 ? (frontLockedTokens / frontTotalSupply) * 100 : 0;
    }

    return {
      poolWalletLamports: balance.toString(),
      poolWalletAddress: wallet,
      frontLockedTokens,
      frontTotalSupply,
      frontLockedPct,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    console.warn('[onchain] snapshot failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Cached on-chain snapshot. Returns null only if the chain read fails
 * and no previous snapshot exists — callers degrade honestly.
 */
export async function getOnchainStats(): Promise<OnchainStats | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchSnapshot().finally(() => { inFlight = null; });
  }
  const fresh = await inFlight;
  if (fresh) cache = fresh;
  return cache;
}
