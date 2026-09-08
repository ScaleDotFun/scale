// ──────────────────────────────────────────────
// LOADED PROTOCOL — Stats Routes
// ──────────────────────────────────────────────

import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { prisma } from '@loaded/database';
import { publicLimiter, authLimiter } from '../middleware/rateLimit';
import { sendSuccess, sendError } from '../lib/response';
import { getOnchainStats } from '../lib/onchain';

const router = Router();

/**
 * Admin gate for every route below that can move money or destroy data.
 *
 * A plain `!==` on an attacker-supplied header leaks the secret a byte at a
 * time under timing analysis, and these routes carry no per-route limiter, so
 * guesses were cheap. Compare in constant time, and refuse outright unless a
 * real secret is configured — an absent or placeholder ADMIN_SECRET must fail
 * closed rather than depend on `undefined` never matching a header string.
 */
const MIN_ADMIN_SECRET_LEN = 24;
function requireAdmin(req: Request, res: Response): boolean {
  const expected = process.env.ADMIN_SECRET ?? '';
  if (expected.length < MIN_ADMIN_SECRET_LEN) {
    console.error(
      `[stats] admin route refused: ADMIN_SECRET is missing or shorter than ${MIN_ADMIN_SECRET_LEN} chars`,
    );
    res.status(503).json({ success: false, error: 'Admin routes are disabled' });
    return false;
  }
  const provided = String(req.headers['x-admin-secret'] ?? '');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    console.warn(`[stats] admin auth failure from ${req.ip} on ${req.path}`);
    res.status(403).json({ success: false, error: 'Forbidden' });
    return false;
  }
  return true;
}

/**
 * GET /stats
 *
 * Return protocol-wide statistics: total burned, pool size, trades executed,
 * listed tokens, active positions, total creator payouts.
 */
router.get('/stats', publicLimiter, async (req, res) => {
  try {
    const [
      burnAgg,
      lockAgg,
      poolAgg,
      creatorPayoutAgg,
      totalPositions,
      activePositions,
      totalListedTokens,
      activeListedTokens,
    ] = await Promise.all([
      // Total burned
      prisma.burn.aggregate({
        _sum: {
          ethAmount: true,
          tokenAmount: true,
        },
      }),
      // Total locked (currently locked, not unlocked)
      prisma.profitLock.aggregate({
        where: { isUnlocked: false },
        _sum: {
          ethAmount: true,
          tokenAmount: true,
        },
      }),
      // Pool balance (sum of all ledger entries)
      prisma.poolLedger.aggregate({
        _sum: { amount: true },
      }),
      // Total creator payouts (claimed)
      prisma.creatorPayout.aggregate({
        where: { status: 'claimed' },
        _sum: { amount: true },
      }),
      // Total trades (positions ever opened)
      prisma.position.count(),
      // Currently active positions
      prisma.position.count({ where: { status: 'open' } }),
      // Total listed tokens
      prisma.token.count(),
      // Active listed tokens
      prisma.token.count({ where: { isActive: true } }),
    ]);

    // The chain is the source of truth for public-facing numbers.
    // The DB ledger is internal accounting and can drift (e.g. funds
    // moved without a ledger entry) — never show it as "the pool".
    const onchain = await getOnchainStats();

    sendSuccess(res, {
      totalBurnedWei: String(burnAgg._sum.ethAmount ?? 0n),
      totalBurnedTokens: String(burnAgg._sum.tokenAmount ?? 0n),
      totalLockedWei: String(lockAgg._sum.ethAmount ?? 0n),
      totalLockedTokens: String(lockAgg._sum.tokenAmount ?? 0n),
      poolSizeWei: onchain?.poolWalletWei ?? String(poolAgg._sum.amount ?? 0n),
      poolLedgerWei: String(poolAgg._sum.amount ?? 0n),
      poolWalletAddress: onchain?.poolWalletAddress ?? null,
      poolSourceOnchain: onchain != null,
      // The protocol's own $LOADED token — the Trade page features it by default
      loadedToken: (process.env.LOADED_TOKEN_MINT || '').trim() || null,
      frontLockedTokens: onchain?.frontLockedTokens ?? null,
      frontTotalSupply: onchain?.frontTotalSupply ?? null,
      frontLockedPct: onchain?.frontLockedPct ?? null,
      totalCreatorPayoutsWei: String(creatorPayoutAgg._sum.amount ?? 0n),
      totalTradesExecuted: totalPositions,
      totalListedTokens,
      activeListedTokens,
      activePositions,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * GET /pool
 *
 * Return capital pool info: current balance, inflows/outflows today, utilization rate.
 */
router.get('/pool', publicLimiter, async (req, res) => {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [poolBalance, todayEntries, capitalLocked, onchain] = await Promise.all([
      // Ledger total (internal accounting)
      prisma.poolLedger.aggregate({
        _sum: { amount: true },
      }),
      // Today's ledger entries
      prisma.poolLedger.findMany({
        where: { createdAt: { gte: twentyFourHoursAgo } },
        select: {
          type: true,
          amount: true,
        },
      }),
      // Capital currently locked in open positions
      prisma.position.aggregate({
        where: { status: 'open' },
        _sum: { protocolCapital: true },
      }),
      // Real wallet balance — the number users can verify on the Robinhood explorer
      getOnchainStats(),
    ]);

    const balance = onchain
      ? BigInt(onchain.poolWalletWei)
      : (poolBalance._sum.amount ?? 0n);
    const lockedCapital = capitalLocked._sum.protocolCapital ?? 0n;

    // Separate inflows and outflows for today
    let inflowsToday = 0n;
    let outflowsToday = 0n;
    const flowsByType = new Map<string, bigint>();

    for (const entry of todayEntries) {
      const current = flowsByType.get(entry.type) ?? 0n;
      flowsByType.set(entry.type, current + entry.amount);

      if (entry.amount > 0n) {
        inflowsToday += entry.amount;
      } else {
        outflowsToday += entry.amount; // negative
      }
    }

    // Utilization rate = capital locked in open positions / total pool balance
    const utilizationRate = balance > 0n
      ? Number(lockedCapital * 10000n / balance) / 100
      : 0;

    sendSuccess(res, {
      balance: String(balance),
      balanceSourceOnchain: onchain != null,
      ledgerBalance: String(poolBalance._sum.amount ?? 0n),
      lockedCapital: String(lockedCapital),
      availableCapital: String(balance > lockedCapital ? balance - lockedCapital : 0n),
      utilizationRate,
      today: {
        inflows: String(inflowsToday),
        outflows: String(outflowsToday),
        net: String(inflowsToday + outflowsToday),
        byType: Object.fromEntries(
          Array.from(flowsByType.entries()).map(([k, v]) => [k, String(v)])
        ),
      },
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /admin/seed-pool
 *
 * Seed the pool ledger with an initial deposit. Protected by ADMIN_SECRET.
 * Body: { amountWei: string }
 */
router.post('/admin/seed-pool', authLimiter, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const amountWei = BigInt(req.body.amountWei || '0');
    if (amountWei <= 0n) {
      return res.status(400).json({ success: false, error: 'amountWei must be positive' });
    }

    await prisma.poolLedger.create({
      data: {
        type: 'initial_deposit',
        amount: amountWei,
        txHash: 'admin-seed-deposit',
      },
    });

    const poolAgg = await prisma.poolLedger.aggregate({ _sum: { amount: true } });

    sendSuccess(res, {
      message: 'Pool seeded',
      deposited: amountWei.toString(),
      totalPool: (poolAgg._sum.amount ?? 0n).toString(),
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /admin/fund-wallet
 *
 * Transfer ETH from the protocol wallet to a target address. Protected by ADMIN_SECRET.
 * Body: { destinationAddress: string, amountWei: string }  (amount in wei)
 */
router.post('/admin/fund-wallet', authLimiter, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { destinationAddress, amountWei } = req.body;
    if (!destinationAddress || !amountWei) {
      return res.status(400).json({ success: false, error: 'destinationAddress and amountWei required' });
    }

    const { getProtocolAccount, transferNative, isValidAddress } = await import('@loaded/evm');
    if (!isValidAddress(String(destinationAddress))) {
      return res.status(400).json({ success: false, error: 'destinationAddress must be a Robinhood Chain address (0x…)' });
    }
    const protocolAccount = getProtocolAccount();
    const amount = BigInt(amountWei);

    const txSig = await transferNative(protocolAccount, destinationAddress, amount);

    // Record the outflow. Without this a successful call moved pool ETH with
    // no internal trace at all, so the ledger would keep reporting money that
    // had already left the wallet.
    await prisma.poolLedger.create({
      data: {
        type: 'admin_withdrawal',
        amount: -amount,
        txHash: txSig,
      },
    }).catch((e) => console.error('[stats] CRITICAL: admin withdrawal ledger write failed:', e));

    sendSuccess(res, {
      message: 'Wallet funded',
      destination: destinationAddress,
      amount: amount.toString(),
      txHash: txSig,
    });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /admin/backfill-tokens
 *
 * Backfill name/symbol/imageUri for all tokens missing metadata.
 * Protected by ADMIN_SECRET.
 */
router.post('/admin/backfill-tokens', authLimiter, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const tokens = await prisma.token.findMany({
      where: { OR: [{ name: null }, { symbol: null }, { imageUri: null }] },
    });

    const results: Array<{ address: string; name: string | null; symbol: string | null }> = [];

    for (const token of tokens) {
      try {
        const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
        if (dexRes.ok) {
          const dexData = await dexRes.json() as {
            pairs?: Array<{ baseToken?: { name?: string; symbol?: string }; info?: { imageUrl?: string } }>;
          };
          const pair = dexData.pairs?.[0];
          if (pair?.baseToken) {
            const newName = token.name || pair.baseToken.name || null;
            const newSymbol = token.symbol || pair.baseToken.symbol || null;
            const newImage = token.imageUri || pair.info?.imageUrl || null;
            await prisma.token.update({
              where: { id: token.id },
              data: { name: newName, symbol: newSymbol, imageUri: newImage },
            });
            results.push({ address: token.address, name: newName, symbol: newSymbol });
          }
        }
      } catch {
        // Skip failed lookups
      }
    }

    sendSuccess(res, { updated: results.length, tokens: results });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * POST /admin/reset-tokens
 *
 * Deactivate all tokens or delete specific ones. Protected by ADMIN_SECRET.
 * Body: { action: 'deactivate-all' | 'delete-all' }
 */
router.post('/admin/reset-tokens', authLimiter, async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const { action, tokenAddress } = req.body;

    if (action === 'delete-all') {
      // Position rows are the recovery record: status, collateralTx, openTx and
      // closeTx are what the reconciliation sweep and sweep-pool use to finish
      // or refund anything in flight. Deleting them while money is committed
      // destroys the only map back to it.
      const live = await prisma.position.count({
        where: { status: { in: ['opening', 'open', 'closing'] } },
      });
      if (live > 0 && req.body.force !== true) {
        return res.status(409).json({
          success: false,
          error:
            `Refusing to delete: ${live} position(s) still hold funds on-chain, and their rows are the ` +
            `only record of where that money is. Close or reconcile them first, or resend with force: true.`,
        });
      }
      const delPositions = await prisma.position.deleteMany({});
      const delTokens = await prisma.token.deleteMany({});
      sendSuccess(res, {
        message: 'All tokens and positions deleted',
        deletedTokens: delTokens.count,
        deletedPositions: delPositions.count,
      });
    } else if (action === 'force-list' && tokenAddress) {
      // Admin-verified listing — bypasses fee check for tokens we've
      // manually confirmed have fees going to protocol
      const existing = await prisma.token.findFirst({
        where: { address: { equals: tokenAddress, mode: 'insensitive' } },
      });
      if (existing) {
        // Reactivate if deactivated
        await prisma.token.update({ where: { id: existing.id }, data: { isActive: true } });
        sendSuccess(res, { message: 'Token reactivated', address: tokenAddress });
      } else {
        // Fetch metadata from GeckoTerminal (Robinhood Chain)
        let name = 'Unknown', symbol = '???', imageUri = '', creator = '', marketCap = 0;
        let liquidity = 0;
        try {
          const { fetchToken } = await import('../lib/geckoterminal');
          const gt = await fetchToken(tokenAddress);
          name = gt.name !== 'Unknown' ? gt.name : name;
          symbol = gt.symbol !== '???' ? gt.symbol : symbol;
          imageUri = gt.logoURI || '';
          marketCap = gt.marketCap;
          liquidity = gt.liquidity;
        } catch { /* use defaults */ }

        // Use the liquidity the feed actually reported. Substituting 10% of
        // market cap when it reports none invented the exact number the tier
        // decision turns on, and passing "has any liquidity" as isBonded
        // claimed graduation the feed never said anything about.
        const { determineTier } = await import('@loaded/core');
        const tierConfig = determineTier(marketCap, liquidity, false);
        const tier = tierConfig ? tierConfig.tier : 'degen';

        const token = await prisma.token.create({
          data: {
            address: tokenAddress,
            name,
            symbol,
            imageUri,
            creatorWallet: creator,
            tier: tier as any,
            isActive: true,
            isAutoListed: true,
          },
        });
        sendSuccess(res, {
          message: 'Token force-listed',
          token: { id: token.id, name, symbol, tier },
          warning:
            'Force-listing bypasses the fee gate but not the re-verification sweep: unless this address ' +
            'is in LOADED_VERIFIED_TOKENS, the scanner will delist it again within about 15 minutes.',
        });
      }
    } else {
      const updated = await prisma.token.updateMany({
        data: { isActive: false },
      });
      sendSuccess(res, { message: 'All tokens deactivated', count: updated.count });
    }
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
