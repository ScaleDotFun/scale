// ──────────────────────────────────────────────
// SCALE PROTOCOL — Error Monitoring
// ──────────────────────────────────────────────
//
// Captures and reports critical errors. Forwards to Sentry when
// SENTRY_DSN is set (see ./sentry); always logs structurally.
//

import { createChildLogger } from './logger';
import { Sentry, sentryEnabled } from './sentry';

const monitorLogger = createChildLogger('monitor');

interface ErrorContext {
  userId?: string;
  positionId?: number;
  action?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Capture and report a critical error.
 * In production, this would forward to Sentry / Datadog / PagerDuty.
 */
export function captureError(error: Error, context?: ErrorContext): void {
  monitorLogger.error({
    message: error.message,
    stack: error.stack,
    ...context,
  }, 'CRITICAL ERROR');

  if (sentryEnabled) {
    Sentry.captureException(error, { extra: { ...context } });
  }
}

/**
 * Log a structured message for monitoring dashboards.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  monitorLogger[level === 'warning' ? 'warn' : level](message);
  if (sentryEnabled && level !== 'info') {
    Sentry.captureMessage(message, level);
  }
}

/**
 * Track critical financial operations for audit trail.
 * All SOL movements, burns, and payouts should go through this.
 */
export function trackFinancialOp(
  op: string,
  details: Record<string, unknown>,
): void {
  monitorLogger.info({
    operation: op,
    ...details,
  }, 'financial operation');
}
