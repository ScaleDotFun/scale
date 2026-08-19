// ──────────────────────────────────────────────
// SCALE PROTOCOL — Services Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @scale/database (Prisma) ────
vi.mock('@scale/database', () => ({
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
      aggregate: vi.fn(() => ({ _sum: { amount: 0n, tokenAmount: 0n, solAmount: 0n }, _count: 0 })),
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

// ─── Mock @scale/solana ──────────────
const MOCK_POOL_PUBKEY = 'Poo1Wa11etMock1111111111111111111111111111';
vi.mock('@scale/solana', () => ({
  WSOL_MINT: 'So11111111111111111111111111111111111111112',
  INCINERATOR: '1nc1nerator11111111111111111111111111111111',
  getProtocolAccount: vi.fn(() => ({
    publicKey: { toBase58: () => MOCK_POOL_PUBKEY },
  })),
  hasProtocolKey: vi.fn(() => true),
  protocolPublicKey: vi.fn(() => MOCK_POOL_PUBKEY),
  isValidSolanaAddress: vi.fn((addr: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)),
  getSolBalance: vi.fn(() => Promise.resolve(0n)),
  transferSol: vi.fn(() => Promise.resolve('mockTransferSig1111111111111111111111111111')),
  splBalance: vi.fn(() => Promise.resolve(10n ** 15n)),
  splDecimals: vi.fn(() => Promise.resolve(6)),
  splTotalSupply: vi.fn(() => Promise.resolve(10n ** 15n)),
  splTransfer: vi.fn(() => Promise.resolve('mockSplTransferSig111111111111111111111111')),
  splBurn: vi.fn(() => Promise.resolve('mockBurnSig11111111111111111111111111111111')),
  swapSolForToken: vi.fn(() => Promise.resolve({ txHash: 'mockBuySig11111111111111111111111111111111', amountOut: 1_000_000n })),
  swapTokenForSol: vi.fn(() => Promise.resolve({ txHash: 'mockSellSig1111111111111111111111111111111', amountOut: 10n ** 9n })),
  getJupToken: vi.fn(() => Promise.resolve(null)),
  getRecentPumpTokens: vi.fn(() => Promise.resolve([])),
  getTrendingTokens: vi.fn(() => Promise.resolve([])),
  verifyPumpToken: vi.fn(() => Promise.resolve({ status: 'not_found' })),
  getUsdPrices: vi.fn(() => Promise.resolve(new Map())),
  getSolUsd: vi.fn(() => Promise.resolve(75)),
}));

// ─── Mock BullMQ ──────────────────────────────
vi.mock('bullmq', () => {
  const mockQueue = {
    add: vi.fn(() => Promise.resolve({ id: 'mock-job-id' })),
    getRepeatableJobs: vi.fn(() => Promise.resolve([])),
    removeRepeatableByKey: vi.fn(() => Promise.resolve()),
  };
  return {
    Queue: vi.fn(() => mockQueue),
    Worker: vi.fn(() => ({
      on: vi.fn(),
      close: vi.fn(() => Promise.resolve()),
    })),
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
