// ──────────────────────────────────────────────
// FRONT PROTOCOL — Custom Error Classes
// ──────────────────────────────────────────────

/**
 * Base application error with HTTP status code.
 * All custom errors extend this class.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** 400 — Invalid input or business rule violation */
export class ValidationError extends AppError {
  public readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message, 400);
    this.details = details;
  }
}

/** 404 — Resource not found */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string | number) {
    const msg = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(msg, 404);
  }
}

/** 401 — Authentication failure */
export class AuthError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401);
  }
}

/** 403 — Forbidden */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403);
  }
}

/** 402/409 — Insufficient funds for the requested operation */
export class InsufficientFundsError extends AppError {
  constructor(message: string = 'Insufficient funds') {
    super(message, 409);
  }
}
