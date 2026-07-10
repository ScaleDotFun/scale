// ──────────────────────────────────────────────
// FRONT PROTOCOL — Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @pump-fun/pump-sdk (before route imports) ────
vi.mock('@pump-fun/pump-sdk', () => ({
  feeSharingConfigPda: vi.fn(() => 'mock-pda'),
  PumpSdk: vi.fn(() => ({
    decodeSharingConfig: vi.fn(() => ({ shareholders: [] })),
  })),
}));

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

// ─── Mock @scale/evm ──────────────
vi.mock('@scale/evm', () => ({
  robinhoodChain: { id: 4663 },
  CONTRACTS: {
    WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    UNIV3_FACTORY: '0x1f7D7550B1B028f7571e69A784071F0205fd2EfA',
    SWAP_ROUTER_02: '0xCaf681a66D020601342297493863E78C959E5cb2',
  },
  NOXA_FEE_TIER: 10_000,
  explorerTxUrl: vi.fn((h: string) => `https://robinhoodchain.blockscout.com/tx/${h}`),
  explorerAddressUrl: vi.fn((a: string) => `https://robinhoodchain.blockscout.com/address/${a}`),
  getPublicClient: vi.fn(() => ({})),
  generateCustodialWallet: vi.fn(() => ({
    address: '0x1111111111111111111111111111111111111111',
    encryptedPrivateKey: 'iv:tag:cipher',
  })),
  loadCustodialWallet: vi.fn(() => ({ address: '0x1111111111111111111111111111111111111111' })),
  getProtocolAccount: vi.fn(() => ({ address: '0x2222222222222222222222222222222222222222' })),
  hasEvmProtocolKey: vi.fn(() => false),
  getEthBalance: vi.fn(() => Promise.resolve(0n)),
  transferEth: vi.fn(() => Promise.resolve('0xmock-tx')),
  erc20Balance: vi.fn(() => Promise.resolve(0n)),
  erc20Decimals: vi.fn(() => Promise.resolve(18)),
  erc20TotalSupply: vi.fn(() => Promise.resolve(0n)),
  swapEthForToken: vi.fn(() => Promise.resolve({ txHash: '0xmock-tx', amountOut: 0n })),
  swapTokenForEth: vi.fn(() => Promise.resolve({ txHash: '0xmock-tx', amountOut: 0n })),
  NOXA: {
    LAUNCH_FACTORY: '0xD9eC2db5f3D1b236843925949fe5bd8a3836FCcB',
    LAUNCH_LOCKER: '0x7F03effbd7ceB22A3f80Dd468f67eF27826acD85',
    FEE_ROUTER: '0x9eFdC1A8e6E94f16A228e44f3025E1f346EE0417',
  },
  noxaLaunchedToken: vi.fn(() => Promise.resolve({ exists: false, deployer: '0x0', poolFee: 10000, positionId: 0n })),
  noxaFeeRouting: vi.fn(() => Promise.resolve({ protocolShare: 65n, receivers: [], percents: [], overridden: false })),
  verifyNoxaFeeRedirect: vi.fn(() => Promise.resolve({
    status: 'not_noxa_token', walletPct: 0, receivers: [], deployer: null,
  })),
  encryptPrivateKey: vi.fn(() => 'iv:tag:cipher'),
  decryptPrivateKey: vi.fn(() => '0x' + '11'.repeat(32)),
}));

// ─── Mock @scale/services ─────────────
vi.mock('@scale/services', () => ({
  default: {},
}));

// ─── Mock @scale/core ──────────────────
vi.mock('@scale/core', () => ({
  WEI_PER_ETH: 10n ** 18n,
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
