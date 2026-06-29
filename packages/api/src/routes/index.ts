// ──────────────────────────────────────────────
// FRONT PROTOCOL — Route Barrel
// ──────────────────────────────────────────────

import { Router } from 'express';
import authRouter from './auth';
import positionsRouter from './positions';
import tokensRouter from './tokens';
import creatorRouter from './creator';
import burnsRouter from './burns';
import locksRouter from './locks';
import statsRouter from './stats';
import telegramRouter from './telegram';

/**
 * Create the root API router and mount all sub-routers.
 *
 * Route map:
 *   /api/auth/*       — wallet signature verification, JWT issuance
 *   /api/positions/*  — open, close, active, history
 *   /api/tokens/*     — listed, trending, details, list new
 *   /api/creator/*    — dashboard, payouts, claim, volume
 *   /api/burns/*      — burn feed, stats
 *   /api/locks/*      — user locks, global lock stats
 *   /api/stats        — protocol stats
 *   /api/pool         — capital pool info
 *   /api/telegram/*   — bot wallet, withdraw, balance
 */
export function createApiRouter(): Router {
  const router = Router();

  router.use('/auth', authRouter);
  router.use('/positions', positionsRouter);
  router.use('/tokens', tokensRouter);
  router.use('/creator', creatorRouter);
  router.use('/burns', burnsRouter);
  router.use('/locks', locksRouter);
  router.use('/telegram', telegramRouter);

  // Stats router handles both GET /stats and GET /pool
  // Mount at root so the paths resolve to /api/stats and /api/pool
  router.use('/', statsRouter);

  return router;
}

export default createApiRouter;
