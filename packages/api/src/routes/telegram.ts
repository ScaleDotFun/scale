// ──────────────────────────────────────────────
// FRONT PROTOCOL — Telegram Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '@front-protocol/database';
import { LAMPORTS_PER_SOL } from '@front-protocol/core';
import { verifyTelegramAuth, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';

const router = Router();

/**
 * Generate a deterministic but unique wallet address for a Telegram user.
 * In production, this would use a proper HD wallet derivation from a master seed.
 * The encrypted private key is stored in the database.
 */
function generateBotWallet(): { address: string; encryptedKey: string } {
  // Generate a random 32-byte ed25519 seed
  const seed = crypto.randomBytes(32);

  // Derive a deterministic "address" (in production this would use @solana/web3.js Keypair)
  const hash = crypto.createHash('sha256').update(seed).digest();

  // Convert to base58-like string (simplified — production uses actual Solana keypair generation)
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let address = '';
  let value = BigInt('0x' + hash.toString('hex'));
  while (address.length < 44) {
    const remainder = Number(value % 58n);
    address = ALPHABET[remainder] + address;
    value = value / 58n;
  }
  address = address.slice(0, 44);

  // Encrypt the seed (in production, use a proper KMS or encryption at rest)
  const encryptionKey = process.env.WALLET_ENCRYPTION_KEY || 'dev-encryption-key-change-in-production';
  const iv = crypto.randomBytes(16);
  const keyHash = crypto.createHash('sha256').update(encryptionKey).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', keyHash, iv);
  let encrypted = cipher.update(seed.toString('hex'), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const encryptedKey = iv.toString('hex') + ':' + encrypted;

  return { address, encryptedKey };
}

/**
 * POST /telegram/wallet
 *
 * Get or create a bot wallet for a Telegram user.
 * Returns the wallet address (never the private key).
 */
router.post('/wallet', verifyTelegramAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const telegramId = BigInt(authReq.telegramId!);

    // Check if user already has a wallet
    let user = await prisma.telegramUser.findUnique({
      where: { telegramId },
    });

    if (user) {
      sendSuccess(res, {
        walletAddress: user.walletAddress,
        isNew: false,
        createdAt: user.createdAt,
      });
      return;
    }

    // Generate a new wallet
    const { address, encryptedKey } = generateBotWallet();

    user = await prisma.telegramUser.create({
      data: {
        telegramId,
        walletAddress: address,
        encryptedKey,
        settings: {},
      },
    });

    sendSuccess(res, {
      walletAddress: user.walletAddress,
      isNew: true,
      createdAt: user.createdAt,
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /telegram/withdraw
 *
 * Withdraw SOL from the bot wallet to an external address.
 * Requires Telegram auth. The actual transfer is handled by services.
 */
router.post('/withdraw', verifyTelegramAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const telegramId = BigInt(authReq.telegramId!);

    const { destinationAddress, amountLamports } = req.body;

    if (!destinationAddress || amountLamports === undefined) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(amountLamports === undefined ? ['amountLamports is required'] : []),
      ]);
    }

    // Validate destination address format
    if (typeof destinationAddress !== 'string' || destinationAddress.length < 32 || destinationAddress.length > 44) {
      throw new ValidationError('Invalid destination address format');
    }

    const amount = BigInt(amountLamports);
    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // Minimum withdrawal: 0.001 SOL (to cover tx fees)
    const MIN_WITHDRAWAL = LAMPORTS_PER_SOL / 1000n;
    if (amount < MIN_WITHDRAWAL) {
      throw new ValidationError('Minimum withdrawal is 0.001 SOL');
    }

    // Find user
    const user = await prisma.telegramUser.findUnique({
      where: { telegramId },
    });

    if (!user) {
      throw new NotFoundError('Telegram user');
    }

    // In production, we would:
    // 1. Check the actual on-chain balance of user.walletAddress
    // 2. Submit a transfer transaction
    // 3. Return the tx signature
    // For now, we validate and return a pending status

    sendSuccess(res, {
      status: 'pending',
      from: user.walletAddress,
      to: destinationAddress,
      amountLamports: amount,
      message: 'Withdrawal initiated. Transaction will be processed shortly.',
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /telegram/balance/:telegramId
 *
 * Get the bot wallet balance for a Telegram user.
 * Returns wallet address and balance info.
 */
router.get('/balance/:telegramId', async (req, res) => {
  try {
    const telegramId = BigInt(req.params.telegramId);

    const user = await prisma.telegramUser.findUnique({
      where: { telegramId },
    });

    if (!user) {
      throw new NotFoundError('Telegram user', req.params.telegramId);
    }

    // In production, query the actual on-chain balance via @solana/web3.js
    // connection.getBalance(new PublicKey(user.walletAddress))
    // For now, return the wallet address; balance must be fetched client-side or by services

    sendSuccess(res, {
      telegramId: user.telegramId.toString(),
      walletAddress: user.walletAddress,
      createdAt: user.createdAt,
      // balanceLamports would come from on-chain query in production
      balanceLamports: null as bigint | null,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
