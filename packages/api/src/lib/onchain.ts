// ──────────────────────────────────────────────
// LOADED PROTOCOL — On-chain truth for public stats (Robinhood Chain)
//
// The DB ledger is protocol accounting; the chain is reality.
// Public stats report the pool wallet's REAL ETH balance and the
// protocol token's locked supply, read from Robinhood Chain and
// cached briefly.
// ──────────────────────────────────────────────

import {
  getNativeBalance,
  erc20Balance,
  erc20TotalSupply,
  erc20Decimals,
  protocolPublicKey,
  isValidAddress,
} from '@loaded/evm';

// The protocol token ($LOADED mint on Robinhood Chain), configured per-launch.
// Until it's set, locked-supply stats are honestly null.
const TOKEN_MINT = (process.env.LOADED_TOKEN_MINT ?? '').trim();

/** Wallets whose protocol-token holdings count as "locked supply"
 *  (0x addresses, comma-separated — invalid entries are dropped). */
const LOCKED_WALLETS: string[] = (process.env.LOADED_LOCKED_WALLETS ?? '')
  .split(',').map((s) => s.trim()).filter((s) => isValidAddress(s));

export interface OnchainStats {
  /** Real ETH balance of the protocol pool wallet, in wei (string) */
  poolWalletWei: string;
  /** Pool wallet address — verify on the Robinhood explorer */
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
    const balance = await getNativeBalance(wallet);

    let frontLockedTokens: number | null = null;
    let frontTotalSupply: number | null = null;
    let frontLockedPct: number | null = null;

    if (isValidAddress(TOKEN_MINT)) {
      const [supplyRaw, decimals, ...locked] = await Promise.all([
        erc20TotalSupply(TOKEN_MINT),
        erc20Decimals(TOKEN_MINT),
        ...LOCKED_WALLETS.map((w) => erc20Balance(TOKEN_MINT, w).catch(() => 0n)),
      ]);
      const div = Math.pow(10, decimals);
      frontTotalSupply = Number(supplyRaw) / div;
      frontLockedTokens = locked.reduce((a, b) => a + Number(b) / div, 0);
      frontLockedPct = frontTotalSupply > 0 ? (frontLockedTokens / frontTotalSupply) * 100 : 0;
    }

    return {
      poolWalletWei: balance.toString(),
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
 * How stale a snapshot may get before it stops being usable at all.
 *
 * The cache used to be returned indefinitely once a refresh started failing,
 * so a balance read minutes or hours out of date could keep authorising
 * positions against money the wallet no longer had. Past this ceiling the
 * honest answer is "unknown", and the trading gate refuses rather than guesses.
 */
const CACHE_HARD_MAX_MS = 10 * 60_000;

/**
 * Cached on-chain snapshot. Returns null when the chain read fails and the
 * last snapshot is too old to stand in for it — callers degrade honestly.
 */
export async function getOnchainStats(): Promise<OnchainStats | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchSnapshot().finally(() => { inFlight = null; });
  }
  const fresh = await inFlight;
  if (fresh) {
    cache = fresh;
    return cache;
  }
  if (cache && Date.now() - cache.fetchedAt < CACHE_HARD_MAX_MS) return cache;
  if (cache) {
    console.error(
      `[onchain] discarding a snapshot ${Math.round((Date.now() - cache.fetchedAt) / 1000)}s old — ` +
      `the chain has been unreadable for too long to keep quoting it`,
    );
    cache = null;
  }
  return null;
}
