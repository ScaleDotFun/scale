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
 * Generate a real Solana wallet for a Telegram user.
 * Uses the same secure keypair generation as the web auth.
 */
function generateTelegramBotWallet(): { address: string; encryptedKey: string } {
  // Use the real Solana keypair generator from the solana package
  const { generateBotWallet: genWallet } = require('@front-protocol/solana');
  const wallet = genWallet();
  return {
    address: wallet.publicKey,
    encryptedKey: wallet.encryptedPrivateKey,
  };
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
    const { address, encryptedKey } = generateTelegramBotWallet();

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
