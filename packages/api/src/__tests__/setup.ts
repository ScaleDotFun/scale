// ──────────────────────────────────────────────
// LOADED PROTOCOL — Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @loaded/database (Prisma) ────
vi.mock('@loaded/database', () => ({
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

// ─── Mock @loaded/evm ──────────────
// Mock accounts mirror viem PrivateKeyAccount shape: .address
// NOTE: vi.mock factories are hoisted — keep every value self-contained.
export const MOCK_USER_WALLET = '0x0044adb6841a38e67f3741e981163f576013b696';
export const MOCK_POOL_WALLET = '0x8cc7b91c4411f8be28e945a5f8e881a5aba0b8f2';

vi.mock('@loaded/evm', () => ({
  ROBINHOOD_RPC: 'https://rpc.mainnet.chain.robinhood.com',
  NATIVE_TOKEN: '0x0000000000000000000000000000000000000000',
  DEAD_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  explorerTxUrl: vi.fn((h: string) => `https://explorer.chain.robinhood.com/tx/${h}`),
  explorerAddressUrl: vi.fn((a: string) => `https://explorer.chain.robinhood.com/address/${a}`),
  // mirrors the real classifier: the venue decides, and the "-robinhood"
  // suffix must be stripped so plain AMMs are not treated as launchpads
  isLaunchpadToken: vi.fn((_address: string, launchpad?: string | null) => {
    if (!launchpad) return false;
    const d = launchpad.toLowerCase().replace(/-robinhood$/, '');
    return ['pons', 'hoodit', 'uniswap-pools-trade', 'clanker', 'bankr', 'virtuals']
      .some((k) => d === k || d.startsWith(k + '-'));
  }),
  explorerTokenUrl: vi.fn((t: string) => `https://explorer.chain.robinhood.com/token/${t}`),
  getPublicClient: vi.fn(() => ({})),
  isValidAddress: vi.fn(
    (addr: string) => typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr),
  ),
  generateCustodialWallet: vi.fn(() => ({
    address: '0x0044adb6841a38e67f3741e981163f576013b696',
    encryptedPrivateKey: 'iv:tag:cipher',
  })),
  loadCustodialWallet: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111',
  })),
  getProtocolAccount: vi.fn(() => ({
    address: '0x2222222222222222222222222222222222222222',
  })),
  hasProtocolKey: vi.fn(() => false),
  protocolPublicKey: vi.fn(() => (process.env.PROTOCOL_WALLET || '').trim() || null),
  getNativeBalance: vi.fn(() => Promise.resolve(0n)),
  transferNative: vi.fn(() => Promise.resolve('mock-signature')),
  erc20Balance: vi.fn(() => Promise.resolve(0n)),
  erc20Decimals: vi.fn(() => Promise.resolve(6)),
  erc20TotalSupply: vi.fn(() => Promise.resolve(0n)),
  erc20Transfer: vi.fn(() => Promise.resolve('mock-signature')),
  erc20Burn: vi.fn(() => Promise.resolve('mock-signature')),
  aggregatorQuote: vi.fn(() => Promise.resolve(null)),
  quoteExactInput: vi.fn(() => Promise.resolve(0n)),
  swapNativeForToken: vi.fn(() => Promise.resolve({ txHash: 'mock-tx', amountOut: 0n })),
  swapTokenForNative: vi.fn(() => Promise.resolve({ txHash: 'mock-tx', amountOut: 0n })),
  getTokenInfo: vi.fn(() => Promise.resolve(null)),
  getTrendingTokens: vi.fn(() => Promise.resolve([])),
  getTrendingTokens: vi.fn(() => Promise.resolve([])),
  verifyCreatorFeeShare: vi.fn(() => Promise.resolve({ status: 'not_found', walletPct: 0, shareholders: [] })),
  verifyLaunchpadToken: vi.fn(() => Promise.resolve({ status: 'not_found' })),
  getUsdPrices: vi.fn(() => Promise.resolve(new Map())),
  getEthUsd: vi.fn(() => Promise.resolve(200)),
  encryptPrivateKey: vi.fn(() => 'iv:tag:cipher'),
  decryptPrivateKey: vi.fn(() => 'hex-secret-key'),
}));

// ─── Mock @loaded/core ──────────────────
vi.mock('@loaded/core', () => ({
  WEI_PER_ETH: 10n ** 9n,
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
