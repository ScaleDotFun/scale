// ──────────────────────────────────────────────
// SCALE PROTOCOL — Error Class Tests
// ──────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  AuthError,
  ForbiddenError,
  InsufficientFundsError,
} from '../lib/errors';

describe('AppError', () => {
  it('has correct defaults', () => {
    const err = new AppError('Something went wrong');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AppError);
    expect(err.message).toBe('Something went wrong');
    expect(err.statusCode).toBe(500);
    expect(err.isOperational).toBe(true);
    expect(err.name).toBe('AppError');
  });

  it('accepts custom statusCode and isOperational', () => {
    const err = new AppError('Fatal', 503, false);
    expect(err.statusCode).toBe(503);
    expect(err.isOperational).toBe(false);
  });
});

describe('ValidationError', () => {
  it('has status 400 and name ValidationError', () => {
    const err = new ValidationError('Bad input');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe('ValidationError');
    expect(err.details).toEqual([]);
  });

  it('includes details array when provided', () => {
    const err = new ValidationError('Validation failed', [
      'name is required',
      'email is invalid',
    ]);
    expect(err.details).toEqual(['name is required', 'email is invalid']);
  });
});

describe('NotFoundError', () => {
  it('has status 404 and name NotFoundError', () => {
    const err = new NotFoundError('User');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('NotFoundError');
    expect(err.message).toBe('User not found');
  });

  it('includes identifier in message when provided', () => {
    const err = new NotFoundError('Token', 'abc123');
    expect(err.message).toBe('Token not found: abc123');
  });

  it('supports numeric identifiers', () => {
    const err = new NotFoundError('Position', 42);
    expect(err.message).toBe('Position not found: 42');
  });
});

describe('AuthError', () => {
  it('has status 401 and name AuthError', () => {
    const err = new AuthError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('AuthError');
    expect(err.message).toBe('Authentication required');
  });

  it('accepts custom message', () => {
    const err = new AuthError('Token expired');
    expect(err.message).toBe('Token expired');
    expect(err.statusCode).toBe(401);
  });
});

describe('ForbiddenError', () => {
  it('has status 403 and name ForbiddenError', () => {
    const err = new ForbiddenError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(403);
    expect(err.name).toBe('ForbiddenError');
    expect(err.message).toBe('Forbidden');
  });

  it('accepts custom message', () => {
    const err = new ForbiddenError('Admin only');
    expect(err.message).toBe('Admin only');
  });
});

describe('InsufficientFundsError', () => {
  it('has status 409 and name InsufficientFundsError', () => {
    const err = new InsufficientFundsError();
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('InsufficientFundsError');
    expect(err.message).toBe('Insufficient funds');
  });

  it('accepts custom message', () => {
    const err = new InsufficientFundsError('Not enough SOL');
    expect(err.message).toBe('Not enough SOL');
  });
});
