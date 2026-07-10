// ──────────────────────────────────────────────
// FRONT PROTOCOL — Auth Routes (Email/Password)
// ──────────────────────────────────────────────

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { prisma } from '@scale/database';
import { generateCustodialWallet, loadCustodialWallet, getEthBalance, transferEth } from '@scale/evm';
import { issueToken, verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';
import { ValidationError, AuthError } from '../lib/errors';
import { authLimiter } from '../middleware/rateLimit';
import { signupIdentity, assertSignupAllowed } from '../lib/signupGuard';

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
 * Generates a Robinhood Chain (EVM) wallet and encrypts the private key.
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

    // Sybil resistance — one account per device / bounded per network
    const identity = signupIdentity(req);
    await assertSignupAllowed(identity);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate a custodial Robinhood Chain (EVM) wallet
    const { address: walletAddress, encryptedPrivateKey: encryptedKey } = generateCustodialWallet();

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        walletAddress,
        encryptedKey,
        registrationIp: identity.ip,
        deviceId: identity.deviceId,
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
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AuthError('Invalid email or password');
    }

    // Compare password
    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new AuthError('Invalid email or password');
    }

    // Robinhood Chain migration: accounts created in the Solana era get
    // a fresh EVM wallet on first login; the old wallet + key move to
    // legacy columns so any funds stay recoverable.
    if (!user.walletAddress.startsWith('0x')) {
      const fresh = generateCustodialWallet();
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          legacyWalletAddress: user.walletAddress,
          legacyEncryptedKey: user.encryptedKey,
          walletAddress: fresh.address,
          encryptedKey: fresh.encryptedPrivateKey,
        },
      });
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

    // Fetch real balance from Robinhood Chain
    const balanceLamports = await getEthBalance(user.walletAddress);
    const balanceSol = (Number(balanceLamports) / 1e18).toFixed(6);

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
 * Withdraw ETH from the user's custodial wallet to an external Robinhood Chain address.
 * Users can only withdraw SOL from their own wallet — never protocol funds.
 */
router.post('/withdraw', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;
    const { destinationAddress, amountLamports } = req.body;

    if (!destinationAddress || !amountLamports) {
      throw new ValidationError('Missing required fields', [
        ...(!destinationAddress ? ['destinationAddress is required'] : []),
        ...(!amountLamports ? ['amountLamports is required'] : []),
      ]);
    }

    // Validate Robinhood Chain (EVM) address format
    if (typeof destinationAddress !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress)) {
      throw new ValidationError('Invalid destination address — expected a Robinhood Chain (0x…) address');
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


    const userAccount = loadCustodialWallet(user.encryptedKey);
    let amount: bigint;
    try {
      amount = BigInt(amountLamports);
    } catch {
      throw new ValidationError('Invalid amount — must be a numeric string');
    }

    // Check balance (reserve a gas buffer — L2 gas is cheap but not free)
    const GAS_BUFFER_WEI = 50_000_000_000_000n; // 0.00005 ETH
    const balance = await getEthBalance(user.walletAddress);
    if (balance < amount + GAS_BUFFER_WEI) {
      throw new AuthError(
        `Insufficient balance. You have ${(Number(balance) / 1e18).toFixed(6)} ETH but tried to withdraw ${(Number(amount) / 1e18).toFixed(6)} ETH (plus gas)`,
      );
    }

    // Execute transfer on Robinhood Chain
    const signature = await transferEth(userAccount, destinationAddress, amount);

    console.log(`[auth] Withdraw ${Number(amount) / 1e18} ETH from ${user.walletAddress} to ${destinationAddress}: ${signature}`);

    sendSuccess(res, {
      txSignature: signature,
      amountSol: (Number(amount) / 1e18).toFixed(6),
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
// Route OAuth through the branded domain — Google's consent screen shows
// this redirect_uri, so it must be front.fun, never the raw Railway host.
// Vercel proxies /api/* to this backend, so the branded path resolves here.
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL
  || (process.env.NODE_ENV === 'production'
    ? 'https://www.scale.fun/api/auth/google/callback'
    : 'http://localhost:4001/api/auth/google/callback');
const FRONTEND_URL = process.env.FRONTEND_URL
  || (process.env.NODE_ENV === 'production' ? 'https://www.scale.fun' : 'http://localhost:5173');

/** One-time auth codes: code → { token, expiresAt } */
const authCodeStore = new Map<string, { token: string; expiresAt: number }>();

/**
 * GET /auth/google
 *
 * Redirect to Google OAuth consent screen.
 * Generates a CSRF state parameter stored in a secure httpOnly cookie.
 */
router.get('/google', (req, res) => {
  // The CSRF state cookie must be set while the BROWSER is on the same
  // host Google returns to (cookies don't cross domains). Requests can
  // arrive here on the Railway host directly (old cached bundles) or
  // through the Vercel proxy — and the proxy presents the destination
  // Host, so we can never trust headers to know where the browser is.
  // Solution: unconditionally bounce ONCE to the callback origin. After
  // the bounce the browser's address bar IS the callback host, so the
  // Set-Cookie on the next response scopes correctly no matter which
  // path the request takes to reach us.
  const cbOrigin = new URL(GOOGLE_CALLBACK_URL).origin;
  if (req.query.hop !== '1') {
    return res.redirect(`${cbOrigin}/api/auth/google?hop=1`);
  }

  const state = crypto.randomBytes(32).toString('hex');

  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600_000, // 10 minutes
  });

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'consent',
    state,
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
    const { code, state } = req.query;

    if (!code || typeof code !== 'string') {
      return res.redirect(`${FRONTEND_URL}/auth?error=no_code`);
    }

    // Validate CSRF state parameter
    const storedState = req.cookies?.oauth_state;
    if (!state || !storedState || state !== storedState) {
      return res.redirect(`${FRONTEND_URL}/auth?error=invalid_state`);
    }
    // Clear the state cookie
    res.clearCookie('oauth_state');

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
      return res.redirect(`${FRONTEND_URL}/auth?error=token_exchange_failed`);
    }

    // Fetch user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userInfoRes.json() as any;

    if (!googleUser.email) {
      return res.redirect(`${FRONTEND_URL}/auth?error=no_email`);
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email: googleUser.email } });

    // Robinhood Chain migration — same as password login: Solana-era
    // accounts get a fresh EVM wallet; the old wallet + key move to
    // legacy columns so any funds stay recoverable.
    if (user && !user.walletAddress.startsWith('0x')) {
      const fresh = generateCustodialWallet();
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          legacyWalletAddress: user.walletAddress,
          legacyEncryptedKey: user.encryptedKey,
          walletAddress: fresh.address,
          encryptedKey: fresh.encryptedPrivateKey,
        },
      });
      console.log(`[auth] Migrated ${user.email} to EVM wallet ${user.walletAddress} (google login)`);
    }

    if (!user) {
      // Sybil resistance — same caps as email signup. The device cookie
      // (scale_did) rides the top-level OAuth navigation; IP is best-effort.
      const identity = signupIdentity(req);
      try {
        await assertSignupAllowed(identity);
      } catch {
        return res.redirect(`${FRONTEND_URL}/auth?error=account_limit`);
      }

      // New user — generate a Robinhood Chain (EVM) custodial wallet
      const { address: walletAddress, encryptedPrivateKey: encryptedKey } = generateCustodialWallet();

      // Create with a random password hash (they'll use Google to sign in)
      const randomPass = await bcrypt.hash(crypto.randomUUID(), 12);

      user = await prisma.user.create({
        data: {
          email: googleUser.email,
          passwordHash: randomPass,
          walletAddress,
          encryptedKey,
          registrationIp: identity.ip,
          deviceId: identity.deviceId,
        },
      });
    }

    // Issue JWT and store behind a one-time code (prevents JWT in URL)
    const token = issueToken(user.id, user.walletAddress);
    const authCode = crypto.randomBytes(32).toString('hex');
    authCodeStore.set(authCode, { token, expiresAt: Date.now() + 60_000 }); // 60s expiry

    // Clean up expired codes periodically
    if (authCodeStore.size > 100) {
      const now = Date.now();
      for (const [k, v] of authCodeStore) {
        if (v.expiresAt < now) authCodeStore.delete(k);
      }
    }

    // Redirect with one-time code instead of JWT
    res.redirect(`${FRONTEND_URL}/auth/callback?code=${authCode}`);
  } catch (err) {
    console.error('[Google OAuth] Error:', err);
    res.redirect(`${FRONTEND_URL}/auth?error=oauth_failed`);
  }
});

/**
 * POST /auth/exchange
 *
 * Exchange a one-time auth code for a JWT. The code is valid for 60 seconds.
 */
router.post('/exchange', (req, res) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string') {
      throw new ValidationError('Missing auth code');
    }

    const entry = authCodeStore.get(code);
    if (!entry) {
      throw new AuthError('Invalid or expired auth code');
    }

    // One-time use — delete immediately
    authCodeStore.delete(code);

    if (entry.expiresAt < Date.now()) {
      throw new AuthError('Auth code has expired');
    }

    sendSuccess(res, { token: entry.token });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
