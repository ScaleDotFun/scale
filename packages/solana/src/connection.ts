// ──────────────────────────────────────────────
// FRONT PROTOCOL — Solana Connection Manager
// ──────────────────────────────────────────────

import { Connection, Commitment, type Cluster } from '@solana/web3.js';

const LOG_PREFIX = '[solana:connection]';

/** Default RPC endpoints per cluster */
const DEFAULT_RPC_URLS: Record<string, string> = {
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
};

/** Default commitment level for transactions */
const DEFAULT_COMMITMENT: Commitment = 'confirmed';

/** Singleton connection instance */
let connectionInstance: Connection | null = null;

/** Cached cluster value */
let resolvedCluster: Cluster | null = null;

/**
 * Resolve the Solana cluster from the `SOLANA_CLUSTER` environment variable.
 * Defaults to `mainnet-beta` if unset.
 */
export function getCluster(): Cluster {
  if (resolvedCluster) return resolvedCluster;

  const raw = process.env.SOLANA_CLUSTER ?? 'mainnet-beta';
  const valid: Cluster[] = ['mainnet-beta', 'devnet', 'testnet'];

  if (!valid.includes(raw as Cluster)) {
    console.warn(
      `${LOG_PREFIX} Invalid SOLANA_CLUSTER "${raw}", falling back to mainnet-beta`,
    );
    resolvedCluster = 'mainnet-beta';
  } else {
    resolvedCluster = raw as Cluster;
  }

  return resolvedCluster;
}

/**
 * Resolve the commitment level from the `SOLANA_COMMITMENT` environment variable.
 * Defaults to `confirmed`.
 */
export function getCommitment(): Commitment {
  const raw = process.env.SOLANA_COMMITMENT;
  if (!raw) return DEFAULT_COMMITMENT;

  const valid: Commitment[] = [
    'processed',
    'confirmed',
    'finalized',
    'recent',
    'single',
    'singleGossip',
    'root',
    'max',
  ];

  if (!valid.includes(raw as Commitment)) {
    console.warn(
      `${LOG_PREFIX} Invalid SOLANA_COMMITMENT "${raw}", falling back to confirmed`,
    );
    return DEFAULT_COMMITMENT;
  }

  return raw as Commitment;
}

/**
 * Get (or create) a singleton Solana Connection instance.
 *
 * Reads configuration from environment variables:
 * - `SOLANA_RPC_URL` — custom RPC endpoint (overrides cluster default)
 * - `SOLANA_CLUSTER` — `mainnet-beta` | `devnet` | `testnet` (default: `mainnet-beta`)
 * - `SOLANA_COMMITMENT` — commitment level (default: `confirmed`)
 *
 * @returns A shared `Connection` instance
 */
export function getConnection(): Connection {
  if (connectionInstance) return connectionInstance;

  const cluster = getCluster();
  const commitment = getCommitment();
  const rpcUrl = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC_URLS[cluster]!;

  console.log(
    `${LOG_PREFIX} Creating connection → cluster=${cluster} commitment=${commitment} rpc=${rpcUrl.substring(0, 40)}…`,
  );

  connectionInstance = new Connection(rpcUrl, {
    commitment,
    confirmTransactionInitialTimeout: 60_000,
  });

  return connectionInstance;
}

/**
 * Reset the singleton connection (useful for testing or reconnection).
 */
export function resetConnection(): void {
  connectionInstance = null;
  resolvedCluster = null;
  console.log(`${LOG_PREFIX} Connection reset`);
}
