// ──────────────────────────────────────────────
// FRONT PROTOCOL — Services Test Setup
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

// ─── Mock @scale/evm ──────────────
vi.mock('@scale/evm', () => ({
  CONTRACTS: {
    WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    UNIV3_FACTORY: '0x1f7D7550B1B028f7571e69A784071F0205fd2EfA',
    SWAP_ROUTER_02: '0xCaf681a66D020601342297493863E78C959E5cb2',
  },
  NOXA_FEE_TIER: 10_000,
  DEAD_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  getProtocolAccount: vi.fn(() => ({ address: '0x2222222222222222222222222222222222222222' })),
  hasEvmProtocolKey: vi.fn(() => true),
  getEthBalance: vi.fn(() => Promise.resolve(0n)),
  transferEth: vi.fn(() => Promise.resolve('0xmock-tx')),
  erc20Balance: vi.fn(() => Promise.resolve(10n ** 24n)),
  erc20Decimals: vi.fn(() => Promise.resolve(18)),
  erc20TotalSupply: vi.fn(() => Promise.resolve(10n ** 27n)),
  erc20Transfer: vi.fn(() => Promise.resolve('0xmock-burn-tx')),
  swapEthForToken: vi.fn(() => Promise.resolve({ txHash: '0xmock-buy', amountOut: 1_000_000n })),
  swapTokenForEth: vi.fn(() => Promise.resolve({ txHash: '0xmock-sell', amountOut: 10n ** 18n })),
}));

// ─── Mock @pump-fun/pump-sdk ──────────────────
vi.mock('@pump-fun/pump-sdk', () => ({
  feeSharingConfigPda: vi.fn(() => 'mock-pda'),
  creatorVaultPda: vi.fn(() => 'mock-creator-vault-pda'),
  bondingCurvePda: vi.fn(() => 'mock-bonding-curve-pda'),
  PumpSdk: vi.fn(() => ({
    decodeSharingConfig: vi.fn(() => ({ shareholders: [] })),
    distributeCreatorFees: vi.fn(() => Promise.resolve(null)),
  })),
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
