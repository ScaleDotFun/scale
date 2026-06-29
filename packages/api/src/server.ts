// ──────────────────────────────────────────────
// FRONT PROTOCOL — Express API Server
// ──────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { prisma } from '@front-protocol/database';
import { createApiRouter } from './routes/index';
import { defaultLimiter } from './middleware/rateLimit';
import { AppError } from './lib/errors';
import { sendError } from './lib/response';

const app = express();
const PORT = parseInt(process.env.API_PORT || '4001', 10);

// ──────────────────────────────────────────────
// Global Middleware
// ──────────────────────────────────────────────

// Security headers
app.use(helmet());

// CORS — allow all origins in dev, restrict in production
app.use(
  cors({
    origin: process.env.NODE_ENV === 'production'
      ? process.env.CORS_ORIGIN?.split(',') || ['https://apeharder.com']
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-telegram-id', 'x-telegram-auth'],
  }),
);

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

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

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`\n🦧 FRONT PROTOCOL API server listening on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health:      http://localhost:${PORT}/health`);
  console.log(`   API base:    http://localhost:${PORT}/api\n`);
});

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // Stop accepting new connections
  server.close(() => {
    console.log('[Shutdown] HTTP server closed');
  });

  // Disconnect Prisma
  try {
    await prisma.$disconnect();
    console.log('[Shutdown] Database disconnected');
  } catch (err) {
    console.error('[Shutdown] Error disconnecting database:', err);
  }

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

export { app };
