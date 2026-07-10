// ──────────────────────────────────────────────
// SCALE PROTOCOL — Telegram Routes (Robinhood Chain)
// ──────────────────────────────────────────────

import { Router } from 'express';
import crypto from 'node:crypto';
import { prisma } from '@scale/database';
import { verifyTelegramAuth, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';

const router = Router();

import { generateCustodialWallet } from '@scale/evm';

function generateTelegramBotWallet(): { address: string; encryptedKey: string } {
  const wallet = generateCustodialWallet();
  return {
    address: wallet.address,
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
    let telegramId: bigint;
    try {
      telegramId = BigInt(authReq.telegramId!);
    } catch {
      throw new ValidationError('Invalid Telegram ID — must be a numeric string');
    }

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
 * Withdraw ETH from the bot wallet to an external address.
 * Requires Telegram auth. The actual transfer is handled by services.
 */
router.post('/withdraw', verifyTelegramAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    let telegramId: bigint;
    try {
      telegramId = BigInt(authReq.telegramId!);
    } catch {
      throw new ValidationError('Invalid Telegram ID — must be a numeric string');
    }

    const { destinationAddress, amountLamports } = req.body;

    if (!destinationAddress || amountLamports === undefined) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(amountLamports === undefined ? ['amountLamports is required'] : []),
      ]);
    }

    // Validate destination address format
    if (typeof destinationAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) {
      throw new ValidationError('Invalid destination address — must be a Robinhood Chain (0x…) address');
    }

    let amount: bigint;
    try {
      amount = BigInt(amountLamports);
    } catch {
      throw new ValidationError('Invalid amount — must be a numeric string');
    }
    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // Minimum withdrawal: 0.0001 ETH (to cover tx fees)
    const MIN_WITHDRAWAL = 100_000_000_000_000n;
    if (amount < MIN_WITHDRAWAL) {
      throw new ValidationError('Minimum withdrawal is 0.0001 ETH');
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
router.get('/balance/:telegramId', verifyTelegramAuth, async (req, res) => {
  try {
    let telegramId: bigint;
    try {
      telegramId = BigInt(req.params.telegramId as string);
    } catch {
      throw new ValidationError('Invalid Telegram ID — must be a numeric string');
    }

    const user = await prisma.telegramUser.findUnique({
      where: { telegramId },
    });

    if (!user) {
      throw new NotFoundError('Telegram user', req.params.telegramId as string);
    }

    // Balance is read from Robinhood Chain client-side or by services

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
