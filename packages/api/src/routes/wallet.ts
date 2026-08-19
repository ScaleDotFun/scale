// ──────────────────────────────────────────────
// SCALE PROTOCOL — Wallet Routes (Solana)
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@scale/database';
import {
  getSolBalance,
  loadCustodialWallet,
  transferSol,
  isValidSolanaAddress,
} from '@scale/solana';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';

const router = Router();


/**
 * GET /wallet/balance
 *
 * Returns the authenticated user's custodial wallet SOL balance.
 */
router.get('/balance', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const balanceLamports = await getSolBalance(walletAddress);
    const balanceSol = (Number(balanceLamports) / 1e9).toFixed(9);

    sendSuccess(res, {
      address: walletAddress,
      balanceLamports: balanceLamports.toString(),
      balanceSol,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /wallet/withdraw
 *
 * Withdraw SOL from the user's custodial wallet to an external address.
 * Requires JWT auth. Validates destination, amount, and sufficient balance
 * (keeping a 0.005 SOL reserve for transaction fees).
 */
router.post('/withdraw', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const { destinationAddress, amountLamports } = req.body;

    // ── Validate required fields ──
    if (!destinationAddress || amountLamports === undefined) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(amountLamports === undefined ? ['amountLamports is required'] : []),
      ]);
    }

    // ── Validate destination address format (Solana — base58) ──
    if (
      typeof destinationAddress !== 'string' ||
      !isValidSolanaAddress(destinationAddress)
    ) {
      throw new ValidationError('Invalid destination address — must be a Solana (base58) address');
    }

    // ── Validate amount ──
    let amount: bigint;
    try {
      amount = BigInt(amountLamports);
    } catch {
      throw new ValidationError('Invalid amount — must be a numeric string');
    }
    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // ── Check balance (keep a small fee reserve — Solana fees are cheap but not free) ──
    const TX_FEE_RESERVE = 5_000_000n; // 0.005 SOL
    const currentBalance = await getSolBalance(walletAddress);

    if (currentBalance < amount + TX_FEE_RESERVE) {
      throw new InsufficientFundsError(
        `Not enough SOL to withdraw. Your balance is ${(Number(currentBalance) / 1e9).toFixed(4)} SOL ` +
        `but you need ${(Number(amount) / 1e9).toFixed(4)} SOL plus a small fee reserve. ` +
        `Deposit more SOL or reduce the withdrawal amount.`,
      );
    }

    // ── Load user's custodial wallet keypair ──
    const user = await prisma.user.findFirst({
      where: { walletAddress },
      select: { encryptedKey: true },
    });
    if (!user) {
      throw new NotFoundError('User wallet');
    }

    const userAccount = loadCustodialWallet(user.encryptedKey);

    // ── Execute transfer ──
    const txSignature = await transferSol(userAccount, destinationAddress, amount);

    sendSuccess(res, {
      txSignature,
      amountLamports: amount.toString(),
      destination: destinationAddress,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
