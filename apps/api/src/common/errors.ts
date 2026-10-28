import { HttpStatus } from '@nestjs/common';

/** Machine-readable error codes returned in `{ error: { code } }`. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'FORBIDDEN'
  | 'READ_ONLY'
  | 'NOT_FOUND'
  | 'OUT_OF_STOCK'
  | 'PRODUCT_UNAVAILABLE'
  | 'PRICE_NOT_SET'
  | 'NOT_DELIVERABLE'
  | 'ZONE_REQUIRED'
  | 'ORDERING_CLOSED'
  | 'PICKUP_INVALID'
  | 'BULK_REQUIRED'
  | 'NOT_BULK'
  | 'BULK_NOT_CONFIGURED'
  | 'INVALID_TRANSITION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYMENTS_DISABLED'
  | 'PAYMENT_NOT_VERIFIED'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<ErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  MFA_REQUIRED: HttpStatus.UNAUTHORIZED,
  OTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  READ_ONLY: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  OUT_OF_STOCK: HttpStatus.CONFLICT,
  PRODUCT_UNAVAILABLE: HttpStatus.CONFLICT,
  PRICE_NOT_SET: HttpStatus.UNPROCESSABLE_ENTITY,
  NOT_DELIVERABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  ZONE_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  ORDERING_CLOSED: HttpStatus.UNPROCESSABLE_ENTITY,
  PICKUP_INVALID: HttpStatus.UNPROCESSABLE_ENTITY,
  BULK_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  NOT_BULK: HttpStatus.UNPROCESSABLE_ENTITY,
  BULK_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  ACCOUNT_LOCKED: HttpStatus.LOCKED,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  PAYMENTS_DISABLED: HttpStatus.SERVICE_UNAVAILABLE,
  PAYMENT_NOT_VERIFIED: HttpStatus.CONFLICT,
  SERVICE_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
};

export class AppError extends Error {
  readonly status: HttpStatus;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = STATUS[code];
  }
}

/** Out-of-scope ids are reported as NOT_FOUND so existence never leaks. */
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
