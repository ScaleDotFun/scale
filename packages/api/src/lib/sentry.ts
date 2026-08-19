// ──────────────────────────────────────────────
// SCALE PROTOCOL — Sentry (optional, env-gated)
//
// Set SENTRY_DSN on the service to activate; without it this is a
// complete no-op. Import once at process start.
// ──────────────────────────────────────────────

import * as Sentry from '@sentry/node';

const DSN = (process.env.SENTRY_DSN ?? '').trim();

export const sentryEnabled = DSN.length > 0;

if (sentryEnabled) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.RAILWAY_GIT_COMMIT_SHA ?? undefined,
    tracesSampleRate: 0.1,
    // Custodial-wallet platform: never ship request bodies or headers
    // that could contain user credentials
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.headers;
        delete event.request.cookies;
      }
      return event;
    },
  });
  console.log('[sentry] error tracking active');
}

export { Sentry };
