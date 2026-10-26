import { HttpStatus } from '@nestjs/common';

/** Error codes from API_SPECIFICATION §1.1. */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'MFA_REQUIRED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'OUT_OF_STOCK'
  | 'INVALID_TRANSITION'
  | 'VERSION_CONFLICT'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'SLOT_FULL'
  | 'PRICE_CHANGED'
  | 'NO_SINGLE_OUTLET'
  | 'COUPON_INVALID'
  | 'IDEMPOTENCY_CONFLICT'
  | 'AREA_NOT_SERVICEABLE'
  | 'MIN_ORDER_NOT_MET'
  | 'COD_NOT_ELIGIBLE'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<ErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  MFA_REQUIRED: HttpStatus.UNAUTHORIZED,
  OTP_INVALID: HttpStatus.UNAUTHORIZED,
  OTP_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  OUT_OF_STOCK: HttpStatus.CONFLICT,
  INVALID_TRANSITION: HttpStatus.CONFLICT,
  VERSION_CONFLICT: HttpStatus.CONFLICT,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  ACCOUNT_LOCKED: HttpStatus.LOCKED,
  SLOT_FULL: HttpStatus.CONFLICT,
  PRICE_CHANGED: HttpStatus.CONFLICT,
  NO_SINGLE_OUTLET: HttpStatus.CONFLICT,
  COUPON_INVALID: HttpStatus.CONFLICT,
  IDEMPOTENCY_CONFLICT: HttpStatus.CONFLICT,
  AREA_NOT_SERVICEABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  MIN_ORDER_NOT_MET: HttpStatus.UNPROCESSABLE_ENTITY,
  COD_NOT_ELIGIBLE: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_PROVIDER_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
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

/** Out-of-scope ids are reported as NOT_FOUND so existence never leaks (TRD §5.7). */
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);
