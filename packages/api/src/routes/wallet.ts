// ──────────────────────────────────────────────
// LOADED PROTOCOL — Wallet Routes (Robinhood Chain)
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@loaded/database';
import { WEI_PER_ETH } from '@loaded/core';
import {
  getNativeBalance,
  loadCustodialWallet,
  transferNative,
  isValidAddress,
} from '@loaded/evm';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, NotFoundError, InsufficientFundsError } from '../lib/errors';

const router = Router();


/**
 * GET /wallet/balance
 *
 * Returns the authenticated user's custodial wallet ETH balance.
 */
router.get('/balance', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const balanceWei = await getNativeBalance(walletAddress);
    const balanceEth = (Number(balanceWei) / 1e18).toFixed(9);

    sendSuccess(res, {
      address: walletAddress,
      balanceWei: balanceWei.toString(),
      balanceEth,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /wallet/withdraw
 *
 * Withdraw ETH from the user's custodial wallet to an external address.
 * Requires JWT auth. Validates destination, amount, and sufficient balance
 * (keeping a 0.005 ETH reserve for transaction fees).
 */
router.post('/withdraw', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const walletAddress = authReq.wallet!;

    const { destinationAddress, amountWei } = req.body;

    // ── Validate required fields ──
    if (!destinationAddress || amountWei === undefined) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(amountWei === undefined ? ['amountWei is required'] : []),
      ]);
    }

    // ── Validate destination address format (Robinhood Chain — hex) ──
    if (
      typeof destinationAddress !== 'string' ||
      !isValidAddress(destinationAddress)
    ) {
      throw new ValidationError('Invalid destination address — must be a Robinhood Chain address (0x…)');
    }

    // ── Validate amount ──
    let amount: bigint;
    try {
      amount = BigInt(amountWei);
    } catch {
      throw new ValidationError('Invalid amount — must be a numeric string');
    }
    if (amount <= 0n) {
      throw new ValidationError('Amount must be positive');
    }

    // ── Check balance (keep a small fee reserve — Robinhood Chain fees are cheap but not free) ──
    const TX_FEE_RESERVE = WEI_PER_ETH / 5_000n; // 0.0002 ETH — L2 gas is cheap
    const currentBalance = await getNativeBalance(walletAddress);

    if (currentBalance < amount + TX_FEE_RESERVE) {
      throw new InsufficientFundsError(
        `Not enough ETH to withdraw. Your balance is ${(Number(currentBalance) / 1e18).toFixed(4)} ETH ` +
        `but you need ${(Number(amount) / 1e18).toFixed(4)} ETH plus a small fee reserve. ` +
        `Deposit more ETH or reduce the withdrawal amount.`,
      );
    }

    // ── Block withdrawal while capital is committed ──
    // /auth/withdraw enforces this; this route is a second implementation of
    // the same operation behind the same auth, so without the guard here the
    // check was defeated by changing the path. 'opening' and 'closing' count
    // too: funds are in flight in both, and a refund or payout is owed.
    const openPositionCount = await prisma.position.count({
      where: { userWallet: walletAddress, status: { in: ['open', 'opening', 'closing'] } },
    });
    if (openPositionCount > 0) {
      throw new ValidationError(
        `Cannot withdraw while you have ${openPositionCount} open position(s). Close them first.`,
      );
    }

    // ── Load the user's custodial wallet ──
    const user = await prisma.user.findFirst({
      where: { walletAddress },
      select: { encryptedKey: true },
    });
    if (!user) {
      throw new NotFoundError('User wallet');
    }

    const userAccount = loadCustodialWallet(user.encryptedKey);

    // ── Execute transfer ──
    const txHash = await transferNative(userAccount, destinationAddress, amount);

    sendSuccess(res, {
      txHash,
      amountWei: amount.toString(),
      destination: destinationAddress,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
