// ──────────────────────────────────────────────
// SCALE PROTOCOL — Express App Factory
// ──────────────────────────────────────────────
// Extracted from server.ts so tests can import the app without starting the server.

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createApiRouter } from './routes/index';
import { defaultLimiter } from './middleware/rateLimit';
import { AppError } from './lib/errors';
import { sendError } from './lib/response';

export function createApp(): express.Express {
  const app = express();

  // Behind Vercel→Railway proxies — trust X-Forwarded-For so rate
  // limiting and sybil checks see the real client IP, not the proxy.
  app.set('trust proxy', true);

  // ──────────────────────────────────────────────
  // Global Middleware
  // ──────────────────────────────────────────────

  // Security headers
  app.use(helmet());

  // CORS — allow all origins in dev, restrict in production
  app.use(
    cors({
      origin: process.env.NODE_ENV === 'production'
        ? process.env.CORS_ORIGIN?.split(',') || [
            'https://www.scale.fun', 'https://scale.fun',
            
          ]
        : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-telegram-id', 'x-telegram-auth', 'x-device-id'],
    }),
  );

  // Body parsing
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Cookie parsing (for OAuth CSRF state)
  app.use(cookieParser());

  // Default rate limiter
  app.use(defaultLimiter);

  // ──────────────────────────────────────────────
  // Request Logging
  // ──────────────────────────────────────────────

  app.use((req, res, next) => {
    const start = Date.now();
    const { method, url } = req;

    res.on('finish', () => {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      console.log(
        `[${level}] ${method} ${url} → ${status} (${duration}ms)`,
      );
    });

    next();
  });

  // ──────────────────────────────────────────────
  // Health Check
  // ──────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ──────────────────────────────────────────────
  // API Routes
  // ──────────────────────────────────────────────

  app.use('/api', createApiRouter());

  // ──────────────────────────────────────────────
  // 404 Handler
  // ──────────────────────────────────────────────

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
    });
  });

  // ──────────────────────────────────────────────
  // Global Error Handler
  // ──────────────────────────────────────────────

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[Unhandled Error]', err);

    if (err instanceof AppError) {
      sendError(res, err);
      return;
    }

    // JSON parse errors
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({
        success: false,
        error: 'Invalid JSON in request body',
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message,
    });
  });

  return app;
}
