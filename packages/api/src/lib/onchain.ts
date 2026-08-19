// ──────────────────────────────────────────────
// SCALE PROTOCOL — On-chain truth for public stats (Solana)
//
// The DB ledger is protocol accounting; the chain is reality.
// Public stats report the pool wallet's REAL SOL balance and the
// protocol token's locked supply, read from Solana mainnet and
// cached briefly.
// ──────────────────────────────────────────────

import {
  getSolBalance,
  splBalance,
  splTotalSupply,
  splDecimals,
  protocolPublicKey,
  isValidSolanaAddress,
} from '@scale/solana';

// The protocol token ($SCALE mint on Solana), configured per-launch.
// Until it's set, locked-supply stats are honestly null.
const TOKEN_MINT = (process.env.SCALE_TOKEN_MINT ?? '').trim();

/** Wallets whose protocol-token holdings count as "locked supply"
 *  (base58, comma-separated — invalid entries are dropped). */
const LOCKED_WALLETS: string[] = (process.env.SCALE_LOCKED_WALLETS ?? '')
  .split(',').map((s) => s.trim()).filter((s) => isValidSolanaAddress(s));

export interface OnchainStats {
  /** Real SOL balance of the protocol pool wallet, in lamports (string) */
  poolWalletLamports: string;
  /** Pool wallet address — verify on Solscan */
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
    // Live key pubkey, else PROTOCOL_WALLET env, else null —
    // no pool wallet configured means nothing truthful to report.
    const wallet = protocolPublicKey();
    if (!wallet) return null;
    const balance = await getSolBalance(wallet);

    let frontLockedTokens: number | null = null;
    let frontTotalSupply: number | null = null;
    let frontLockedPct: number | null = null;

    if (isValidSolanaAddress(TOKEN_MINT)) {
      const [supplyRaw, decimals, ...locked] = await Promise.all([
        splTotalSupply(TOKEN_MINT),
        splDecimals(TOKEN_MINT),
        ...LOCKED_WALLETS.map((w) => splBalance(TOKEN_MINT, w).catch(() => 0n)),
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
