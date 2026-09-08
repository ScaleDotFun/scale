// ──────────────────────────────────────────────
// LOADED PROTOCOL — Services Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @loaded/database (Prisma) ────
vi.mock('@loaded/database', () => ({
  prisma: {
    position: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    token: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    poolLedger: {
      create: vi.fn(),
      aggregate: vi.fn(() => ({ _sum: { amount: 0n } })),
    },
    burn: { create: vi.fn() },
    profitLock: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(() => ({ _sum: { amount: 0n, tokenAmount: 0n, ethAmount: 0n }, _count: 0 })),
      count: vi.fn(),
    },
    creatorPayout: { create: vi.fn() },
    feeClaim: { create: vi.fn() },
    insuranceFund: {
      create: vi.fn(),
      aggregate: vi.fn(() => ({ _sum: { amount: 0n } })),
    },
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((args: unknown) => {
      if (Array.isArray(args)) return Promise.resolve(args);
      if (typeof args === 'function') return (args as Function)({
        position: { create: vi.fn(), update: vi.fn() },
        poolLedger: { create: vi.fn() },
        token: { update: vi.fn() },
      });
      return Promise.resolve();
    }),
    $disconnect: vi.fn(),
    $connect: vi.fn(),
  },
}));

// ─── Mock @loaded/evm ──────────────
const MOCK_POOL_PUBKEY = '0x00000000000000000000000000000000000a0001';
vi.mock('@loaded/evm', () => ({
  NATIVE_TOKEN: '0x0000000000000000000000000000000000000000',
  DEAD_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  getProtocolAccount: vi.fn(() => ({
    address: MOCK_POOL_PUBKEY,
  })),
  hasProtocolKey: vi.fn(() => true),
  protocolPublicKey: vi.fn(() => MOCK_POOL_PUBKEY),
  isValidAddress: vi.fn((addr: string) => /^0x[a-fA-F0-9]{40}$/.test(addr)),
  getNativeBalance: vi.fn(() => Promise.resolve(0n)),
  transferNative: vi.fn(() => Promise.resolve('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  erc20Balance: vi.fn(() => Promise.resolve(10n ** 15n)),
  erc20Decimals: vi.fn(() => Promise.resolve(18)),
  erc20TotalSupply: vi.fn(() => Promise.resolve(10n ** 15n)),
  erc20Transfer: vi.fn(() => Promise.resolve('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  erc20Burn: vi.fn(() => Promise.resolve('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  swapNativeForToken: vi.fn(() => Promise.resolve({ txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amountOut: 1_000_000n })),
  swapTokenForNative: vi.fn(() => Promise.resolve({ txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amountOut: 10n ** 18n })),
  getTokenInfo: vi.fn(() => Promise.resolve(null)),
  getTrendingTokens: vi.fn(() => Promise.resolve([])),
  verifyLaunchpadToken: vi.fn(() => Promise.resolve({ status: 'not_found' })),
  verifyCreatorFeeShare: vi.fn(() => Promise.resolve({ status: 'not_found', walletPct: 0, shareholders: [] })),
  getUsdPrices: vi.fn(() => Promise.resolve(new Map())),
  getEthUsd: vi.fn(() => Promise.resolve(2_500)),
  findCurveForToken: vi.fn(() => Promise.resolve(null)),
  readCurveDeployer: vi.fn(() => Promise.resolve(null)),
  readCreatorFeeRecipient: vi.fn(() => Promise.resolve(null)),
  readCurveGraduated: vi.fn(() => Promise.resolve(false)),
  claimVaultCredit: vi.fn(() => Promise.resolve(null)),
  vaultCreditOf: vi.fn(() => Promise.resolve(0n)),
  poolReserveFor: vi.fn((n: number) => 3_000_000_000_000_000n + 1_000_000_000_000_000n * BigInt(n)),
  explorerTxUrl: vi.fn((h: string) => `https://explorer.chain.robinhood.com/tx/${h}`),
}));

// ─── Mock BullMQ ──────────────────────────────
vi.mock('bullmq', () => {
  const mockQueue = {
    add: vi.fn(() => Promise.resolve({ id: 'mock-job-id' })),
    getRepeatableJobs: vi.fn(() => Promise.resolve([])),
    removeRepeatableByKey: vi.fn(() => Promise.resolve()),
  };
  // Constructible: worker modules do `new Worker(...)` at import time, and an
  // arrow-function mock is not a constructor, so importing one threw.
  return {
    Queue: vi.fn(function () { return mockQueue; }),
    // Keep a handle on the processor so tests can drive a worker directly.
    Worker: vi.fn(function (_name: string, processor: unknown) {
      return { on: vi.fn(), close: vi.fn(() => Promise.resolve()), __processor: processor };
    }),
  };
});

// ─── Mock queues module ───────────────────────
vi.mock('../queues.js', () => ({
  redisConnection: {},
  QUEUE_NAMES: {
    PRICE_CHECK: 'price-check',
    POSITION_CLOSE: 'position-close',
    BURN_QUEUE: 'burn',
    LOCK_QUEUE: 'lock',
    CREATOR_PAYOUTS: 'creator-payouts',
    FEE_CLAIMS: 'fee-claims',
    INSURANCE_FUND: 'insurance-fund',
  },
  priceCheckQueue: {
    add: vi.fn(() => Promise.resolve()),
    getRepeatableJobs: vi.fn(() => Promise.resolve([])),
    removeRepeatableByKey: vi.fn(),
  },
  positionCloseQueue: {
    add: vi.fn(() => Promise.resolve()),
    getJob: vi.fn(() => Promise.resolve(null)),
  },
  burnQueue: {
    add: vi.fn(() => Promise.resolve()),
  },
  lockQueue: {
    add: vi.fn(() => Promise.resolve()),
    getRepeatableJobs: vi.fn(() => Promise.resolve([])),
    removeRepeatableByKey: vi.fn(),
  },
  creatorPayoutsQueue: {
    add: vi.fn(() => Promise.resolve()),
  },
  feeClaimsQueue: {
    add: vi.fn(() => Promise.resolve()),
    getRepeatableJobs: vi.fn(() => Promise.resolve([])),
    removeRepeatableByKey: vi.fn(),
  },
  insuranceFundQueue: {
    add: vi.fn(() => Promise.resolve()),
  },
}));

// ─── Mock ioredis ─────────────────────────────
vi.mock('ioredis', () => ({
  default: vi.fn(() => ({
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve('OK')),
    call: vi.fn(() => Promise.resolve('0')),
  })),
}));
