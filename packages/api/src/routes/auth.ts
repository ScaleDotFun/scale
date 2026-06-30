// ──────────────────────────────────────────────
// FRONT PROTOCOL — Auth Routes (Email/Password)
// ──────────────────────────────────────────────

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '@front-protocol/database';
import { generateBotWallet } from '@front-protocol/solana';
import { issueToken, verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, AuthError } from '../lib/errors';
import { authLimiter } from '../middleware/rateLimit';

const router = Router();

/**
 * Validate email format (basic check).
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * POST /auth/register
 *
 * Create a new custodial account with email + password.
 * Generates a Solana wallet address and encrypts the private key.
 *
 * Body: { email: string, password: string }
 * Returns: { token, user: { id, email, walletAddress } }
 */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate inputs
    const errors: string[] = [];
    if (!email) errors.push('email is required');
    if (!password) errors.push('password is required');
    if (errors.length > 0) {
      throw new ValidationError('Missing required fields', errors);
    }

    if (!isValidEmail(email)) {
      throw new ValidationError('Invalid email format');
    }

    if (typeof password !== 'string' || password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters');
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ValidationError('Email already registered');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate real Solana wallet
    const { publicKey: walletAddress, encryptedPrivateKey: encryptedKey } = generateBotWallet();

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        walletAddress,
        encryptedKey,
      },
    });

    // Issue JWT
    const token = issueToken(user.id, user.walletAddress);

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
      },
    }, 201);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /auth/login
 *
 * Authenticate with email + password.
 *
 * Body: { email: string, password: string }
 * Returns: { token, user: { id, email, walletAddress } }
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ValidationError('Missing required fields', [
        ...(!email ? ['email is required'] : []),
        ...(!password ? ['password is required'] : []),
      ]);
    }

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AuthError('Invalid email or password');
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new AuthError('Invalid email or password');
    }

    // Issue JWT
    const token = issueToken(user.id, user.walletAddress);

    sendSuccess(res, {
      token,
      user: {
        id: user.id,
        email: user.email,
        walletAddress: user.walletAddress,
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /auth/me
 *
 * Return the authenticated user's profile.
 * Requires a valid JWT.
 */
router.get('/me', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        walletAddress: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AuthError('User not found');
    }

    sendSuccess(res, user);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /auth/wallet
 *
 * Return the authenticated user's wallet address and real SOL balance.
 */
router.get('/wallet', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true },
    });

    if (!user) {
      throw new AuthError('User not found');
    }

    // Fetch real balance from on-chain
    const { getSolBalance } = await import('@front-protocol/solana');
    const balanceLamports = await getSolBalance(user.walletAddress);
    const balanceSol = (Number(balanceLamports) / 1e9).toFixed(6);

    sendSuccess(res, {
      walletAddress: user.walletAddress,
      balanceLamports: balanceLamports.toString(),
      balanceSol,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /auth/withdraw
 *
 * Withdraw SOL from user's custodial wallet to an external Solana address.
 * Users can only withdraw SOL from their own wallet — never protocol funds.
 */
router.post('/withdraw', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;
    const { destinationAddress, amountLamports } = req.body;

    if (!destinationAddress || !amountLamports) {
      throw new AuthError('destinationAddress and amountLamports are required');
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true, encryptedKey: true },
    });

    if (!user) {
      throw new AuthError('User not found');
    }

    // Block withdrawal if user has open positions
    const openPositionCount = await prisma.position.count({
      where: { userWallet: user.walletAddress, status: 'open' },
    });
    if (openPositionCount > 0) {
      throw new AuthError(
        `Cannot withdraw while you have ${openPositionCount} open position(s). Close them first.`,
      );
    }

    const { loadBotWallet, getSolBalance, transferSol, getProtocolWallet } = await import('@front-protocol/solana');

    const userKeypair = loadBotWallet(user.encryptedKey);
    const amount = BigInt(amountLamports);

    // Check balance (reserve 5000 lamports for tx fee)
    const balance = await getSolBalance(user.walletAddress);
    if (balance < amount + 5000n) {
      throw new AuthError(
        `Insufficient balance. You have ${(Number(balance) / 1e9).toFixed(6)} SOL but tried to withdraw ${(Number(amount) / 1e9).toFixed(6)} SOL`,
      );
    }

    // Ensure user is NOT trying to withdraw from protocol wallet
    const protocolWallet = getProtocolWallet();
    if (userKeypair.publicKey.equals(protocolWallet.publicKey)) {
      throw new AuthError('Cannot withdraw from protocol wallet');
    }

    // Execute transfer
    const signature = await transferSol(userKeypair, destinationAddress, amount);

    console.log(`[auth] Withdraw ${Number(amount) / 1e9} SOL from ${user.walletAddress} to ${destinationAddress}: ${signature}`);

    sendSuccess(res, {
      txSignature: signature,
      amountSol: (Number(amount) / 1e9).toFixed(6),
      from: user.walletAddress,
      to: destinationAddress,
    });
  } catch (err) {
    sendError(res, err);
  }
});
// ──────────────────────────────────────────────
// Google OAuth
// ──────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4001/api/auth/google/callback';
const FRONTEND_URL = process.env.NODE_ENV === 'production' ? 'https://www.front.fun' : 'http://localhost:5173';

/**
 * GET /auth/google
 *
 * Redirect to Google OAuth consent screen.
 */
router.get('/google', (_req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

/**
 * GET /auth/google/callback
 *
 * Handle Google OAuth callback. Exchange code for tokens,
 * fetch user info, find or create user, issue JWT.
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GOOGLE_CALLBACK_URL,
      }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenData.access_token) {
      console.error('[Google OAuth] Token exchange failed:', tokenData);
      return res.redirect(`${FRONTEND_URL}/login?error=token_exchange_failed`);
    }

    // Fetch user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userInfoRes.json() as any;

    if (!googleUser.email) {
      return res.redirect(`${FRONTEND_URL}/login?error=no_email`);
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email: googleUser.email } });

    if (!user) {
      // New user — generate Solana wallet
      const { publicKey: walletAddress, encryptedPrivateKey: encryptedKey } = generateBotWallet();

      // Create with a random password hash (they'll use Google to sign in)
      const randomPass = await bcrypt.hash(crypto.randomUUID(), 12);

      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          passwordHash: randomPass,
          walletAddress,
          encryptedKey,
        },
      });
    }

    // Issue JWT
    const token = issueToken(user.id, user.walletAddress);

    // Redirect to frontend with token
    res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`);
  } catch (err) {
    console.error('[Google OAuth] Error:', err);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
});

export default router;
