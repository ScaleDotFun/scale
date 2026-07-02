// ──────────────────────────────────────────────
// FRONT PROTOCOL — Services Test Setup
// ──────────────────────────────────────────────

import { vi } from 'vitest';

// ─── Mock @front-protocol/database (Prisma) ────
vi.mock('@front-protocol/database', () => ({
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

// ─── Mock @front-protocol/solana ──────────────
vi.mock('@front-protocol/solana', () => ({
  getConnection: vi.fn(() => ({
    getBalance: vi.fn(() => Promise.resolve(1_000_000_000)),
    getAccountInfo: vi.fn(() => Promise.resolve(null)),
    getLatestBlockhash: vi.fn(() =>
      Promise.resolve({ blockhash: 'mock-blockhash', lastValidBlockHeight: 100 }),
    ),
  })),
  getSolBalance: vi.fn(() => Promise.resolve(1_000_000_000n)),
  getTokenBalance: vi.fn(() => Promise.resolve(0n)),
  swapSolToToken: vi.fn(() =>
    Promise.resolve({ txSignature: 'mock-swap-tx', tokensReceived: 1000n }),
  ),
  swapTokenToSol: vi.fn(() =>
    Promise.resolve({ txSignature: 'mock-sell-tx', solReceived: 2_000_000_000n }),
  ),
  getProtocolWallet: vi.fn(() => ({
    publicKey: { toBase58: () => 'MockProtocolPubkey', equals: () => false },
    secretKey: new Uint8Array(64),
  })),
  loadBotWallet: vi.fn(() => ({
    publicKey: { toBase58: () => 'MockBotPubkey', equals: () => false },
    secretKey: new Uint8Array(64),
  })),
  transferSol: vi.fn(() => Promise.resolve('mock-transfer-tx')),
  burnToken: vi.fn(() => Promise.resolve('mock-burn-tx')),
  generateBotWallet: vi.fn(() => ({
    publicKey: 'MockNewBotPubkey',
    encryptedPrivateKey: 'mock-encrypted-key',
  })),
  getMultipleTokenPrices: vi.fn(() => Promise.resolve(new Map())),
  PublicKey: vi.fn((addr: string) => ({
    toBase58: () => addr,
    equals: (other: any) => addr === other?.toBase58?.(),
  })),
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
