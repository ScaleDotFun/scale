// ──────────────────────────────────────────────
// FRONT PROTOCOL — Express API Server
// ──────────────────────────────────────────────

import './lib/sentry'; // must init before anything else
import 'dotenv/config';
import { validateEnv } from './lib/env';
import { prisma } from '@scale/database';
import { createApp } from './app';

// Validate environment before starting
validateEnv();

const app = createApp();
const PORT = parseInt(process.env.PORT || process.env.API_PORT || '4001', 10);

// ──────────────────────────────────────────────
// Start Server
// ──────────────────────────────────────────────

const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`\nFRONT PROTOCOL API server listening on ${HOST}:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health:      http://localhost:${PORT}/health`);
  console.log(`   API base:    http://localhost:${PORT}/api\n`);
});

// ──────────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  console.log(`\n[${signal}] Shutting down gracefully...`);

  // Force exit after 10 seconds
  const forceTimer = setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  // Stop accepting new connections
  await new Promise<void>((resolve) => {
    server.close(() => {
      console.log('[Shutdown] HTTP server closed');
      resolve();
    });
  });

  // Disconnect Prisma
  try {
    await prisma.$disconnect();
    console.log('[Shutdown] Database disconnected');
  } catch (err) {
    console.error('[Shutdown] Error disconnecting database:', err);
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});

export { app };
