// ──────────────────────────────────────────────
// SCALE PROTOCOL — Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @scale/database (Prisma) ────
vi.mock('@scale/database', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    position: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    token: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    burn: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    lock: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    $disconnect: vi.fn(),
    $connect: vi.fn(),
    $transaction: vi.fn(),
  },
}));

// ─── Mock @scale/solana ──────────────
// Mock keypairs mirror @solana/web3.js Keypair shape: publicKey.toBase58().
// NOTE: vi.mock factories are hoisted — keep every value self-contained.
export const MOCK_USER_WALLET = '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr';
export const MOCK_POOL_WALLET = 'GDfnEsia2WLAW5t8yx2X5j2mkfA74B5675t2kNMaUMPb';

vi.mock('@scale/solana', () => ({
  SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
  JUPITER_API: 'https://lite-api.jup.ag',
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  INCINERATOR: '1nc1nerator11111111111111111111111111111111',
  explorerTxUrl: vi.fn((sig: string) => `https://solscan.io/tx/${sig}`),
  explorerAddressUrl: vi.fn((a: string) => `https://solscan.io/account/${a}`),
  isPumpFunToken: vi.fn((mint: string, launchpad?: string) =>
    (!!launchpad && launchpad.toLowerCase().includes('pump')) || mint.endsWith('pump')),
  explorerTokenUrl: vi.fn((m: string) => `https://solscan.io/token/${m}`),
  getConnection: vi.fn(() => ({})),
  isValidSolanaAddress: vi.fn(
    (addr: string) => typeof addr === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
  ),
  generateCustodialWallet: vi.fn(() => ({
    address: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
    encryptedPrivateKey: 'iv:tag:cipher',
  })),
  loadCustodialWallet: vi.fn(() => ({
    publicKey: { toBase58: () => '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
  })),
  getProtocolAccount: vi.fn(() => ({
    publicKey: { toBase58: () => 'GDfnEsia2WLAW5t8yx2X5j2mkfA74B5675t2kNMaUMPb' },
  })),
  hasProtocolKey: vi.fn(() => false),
  protocolPublicKey: vi.fn(() => (process.env.PROTOCOL_WALLET || '').trim() || null),
  getSolBalance: vi.fn(() => Promise.resolve(0n)),
  transferSol: vi.fn(() => Promise.resolve('mock-signature')),
  splBalance: vi.fn(() => Promise.resolve(0n)),
  splDecimals: vi.fn(() => Promise.resolve(6)),
  splTotalSupply: vi.fn(() => Promise.resolve(0n)),
  splTransfer: vi.fn(() => Promise.resolve('mock-signature')),
  splBurn: vi.fn(() => Promise.resolve('mock-signature')),
  jupiterQuote: vi.fn(() => Promise.resolve(null)),
  quoteExactInput: vi.fn(() => Promise.resolve(0n)),
  swapSolForToken: vi.fn(() => Promise.resolve({ txHash: 'mock-tx', amountOut: 0n })),
  swapTokenForSol: vi.fn(() => Promise.resolve({ txHash: 'mock-tx', amountOut: 0n })),
  getJupToken: vi.fn(() => Promise.resolve(null)),
  getRecentPumpTokens: vi.fn(() => Promise.resolve([])),
  getTrendingTokens: vi.fn(() => Promise.resolve([])),
  verifyPumpToken: vi.fn(() => Promise.resolve({ status: 'not_found' })),
  getUsdPrices: vi.fn(() => Promise.resolve(new Map())),
  getSolUsd: vi.fn(() => Promise.resolve(200)),
  encryptPrivateKey: vi.fn(() => 'iv:tag:cipher'),
  decryptPrivateKey: vi.fn(() => 'base58-secret-key'),
}));

// ─── Mock @scale/core ──────────────────
vi.mock('@scale/core', () => ({
  LAMPORTS_PER_SOL: 10n ** 9n,
  getTierConfig: vi.fn(() => ({
    name: 'Bronze',
    label: 'DEGEN',
    minBurned: 0,
    feePercent: 1,
    leverageCap: 10,
    maxLeverage: 5,
  })),
  determineTier: vi.fn(() => ({ tier: 'degen', label: 'DEGEN', maxLeverage: 5 })),
  validatePositionOpen: vi.fn(() => ({ valid: true })),
  validatePositionSafety: vi.fn(() => ({ safe: true })),
  generatePositionPreview: vi.fn(() => ({})),
  calculateProtocolCapital: vi.fn(() => BigInt(0)),
  calculatePositionSize: vi.fn(() => BigInt(0)),
  calculateFlatFee: vi.fn(() => BigInt(0)),
  getExitThresholdPercent: vi.fn(() => 5),
}));

import { createApp } from '../app';
import supertest from 'supertest';
import type { Express } from 'express';

/**
 * Create a fresh Express app instance wired up with all routes and middleware,
 * without starting the HTTP server.
 *
 * Returns both the Express app and a supertest agent.
 */
export function createTestApp() {
  const app: Express = createApp();
  const agent = supertest(app);
  return { app, agent };
}
