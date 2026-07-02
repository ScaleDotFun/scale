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

// ─── Mock @front-protocol/database (Prisma) ────
vi.mock('@front-protocol/database', () => ({
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

// ─── Mock @front-protocol/solana ──────────────
vi.mock('@front-protocol/solana', () => ({
  getConnection: vi.fn(() => ({})),
  getSolBalance: vi.fn(() => Promise.resolve(0)),
  getTokenBalance: vi.fn(() => Promise.resolve(0)),
  sendTransaction: vi.fn(() => Promise.resolve('mock-tx-hash')),
  confirmTransaction: vi.fn(() => Promise.resolve(true)),
  createTransferInstruction: vi.fn(),
  getTokenAccounts: vi.fn(() => Promise.resolve([])),
  generateBotWallet: vi.fn(() => ({ publicKey: 'mock-pub', secretKey: new Uint8Array(64) })),
  swapSolToToken: vi.fn(() => Promise.resolve('mock-tx')),
  swapTokenToSol: vi.fn(() => Promise.resolve('mock-tx')),
  getProtocolWallet: vi.fn(() => ({ publicKey: 'mock-protocol-pub' })),
  loadBotWallet: vi.fn(() => ({ publicKey: 'mock-bot-pub' })),
  transferSol: vi.fn(() => Promise.resolve('mock-tx')),
}));

// ─── Mock @front-protocol/services ─────────────
vi.mock('@front-protocol/services', () => ({
  default: {},
}));

// ─── Mock @front-protocol/core ──────────────────
vi.mock('@front-protocol/core', () => ({
  LAMPORTS_PER_SOL: BigInt(1_000_000_000),
  getTierConfig: vi.fn(() => ({
    name: 'Bronze',
    minBurned: 0,
    feePercent: 1,
    leverageCap: 10,
  })),
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
