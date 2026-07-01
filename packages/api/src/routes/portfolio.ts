// ──────────────────────────────────────────────
// FRONT PROTOCOL — Portfolio Routes
// ──────────────────────────────────────────────

import { Router } from 'express';
import { prisma } from '@front-protocol/database';
import { verifyWalletSignature, type AuthenticatedRequest } from '../middleware/auth';
import { sendSuccess, sendError } from '../lib/response';

const router = Router();

const HELIUS_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * GET /portfolio
 *
 * Return the authenticated user's complete portfolio:
 * - SOL balance (from Helius RPC)
 * - Open positions summary
 * - Total P&L
 * - Trade count
 */
router.get('/', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId!;
    const wallet = authReq.wallet!;

    // Fetch SOL balance from Helius
    let balanceLamports = 0;
    try {
      const rpcRes = await fetch(HELIUS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBalance',
          params: [wallet],
        }),
      });
      const rpcData = await rpcRes.json() as any;
      balanceLamports = rpcData?.result?.value || 0;
    } catch {
      // RPC error — return 0 balance
    }

    // Get open positions count and total capital
    const openPositions = await prisma.position.findMany({
      where: { userWallet: wallet, status: 'open' },
      include: {
        token: {
          select: { address: true, name: true, symbol: true, tier: true },
        },
      },
    });

    // Get closed positions stats
    const closedStats = await prisma.position.aggregate({
      where: { userWallet: wallet, status: { not: 'open' } },
      _sum: { pnlSol: true, userProfit: true },
      _count: true,
    });

    // Total user capital in open positions
    const totalCapitalInPositions = openPositions.reduce(
      (sum, p) => sum + Number(p.userCapital),
      0
    );

    // Get profit locks
    const locks = await prisma.profitLock.aggregate({
      where: { userWallet: wallet, isUnlocked: false },
      _sum: { solAmount: true },
      _count: true,
    });

    sendSuccess(res, {
      wallet: {
        address: wallet,
        balanceLamports: String(balanceLamports),
        balanceSol: (balanceLamports / 1e9).toFixed(4),
      },
      positions: {
        open: openPositions.length,
        totalCapitalLocked: String(totalCapitalInPositions),
        items: openPositions.map((p) => ({
          id: p.id,
          token: p.token,
          leverage: Number(p.leverage),
          userCapital: String(p.userCapital),
          tier: p.tier,
          openedAt: p.openedAt,
        })),
      },
      history: {
        totalTrades: closedStats._count,
        totalPnlLamports: String(closedStats._sum.pnlSol ?? 0),
        totalProfitLamports: String(closedStats._sum.userProfit ?? 0),
      },
      locks: {
        activeLocks: locks._count,
        totalLockedLamports: String(locks._sum.solAmount ?? 0),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /portfolio/history
 *
 * Return the user's full trade history, most recent first.
 */
router.get('/history', verifyWalletSignature, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const wallet = authReq.wallet!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const [trades, total] = await Promise.all([
      prisma.position.findMany({
        where: { userWallet: wallet },
        include: {
          token: {
            select: { address: true, name: true, symbol: true, tier: true },
          },
        },
        orderBy: { openedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.position.count({ where: { userWallet: wallet } }),
    ]);

    const data = trades.map((t) => ({
      id: t.id,
      token: t.token,
      status: t.status,
      leverage: Number(t.leverage),
      tier: t.tier,
      userCapital: String(t.userCapital),
      protocolCapital: String(t.protocolCapital),
      entryPrice: t.entryPrice ? String(t.entryPrice) : null,
      exitPrice: t.exitPrice ? String(t.exitPrice) : null,
      pnlSol: t.pnlSol ? String(t.pnlSol) : null,
      userProfit: t.userProfit ? String(t.userProfit) : null,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
    }));

    sendSuccess(res, { trades: data, total, limit, offset });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
