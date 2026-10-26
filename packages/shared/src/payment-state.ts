import { assertPoisha, MoneyError, type Poisha } from './money.js';

/** Payment row status (DATABASE_SCHEMA §9). Separate from order status. */
export const PAYMENT_STATUSES = [
  'UNPAID',
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * Source of a payment transition:
 * - GATEWAY_VERIFIED: server-to-server verification with the gateway succeeded.
 *   Browser redirects and unverified callbacks are never a source.
 * - COD_HANDOVER: outlet manager confirmed receipt of COD cash.
 * - REFUND: a refund succeeded at the gateway.
 * - SYSTEM: timeouts, initiation, cancellations.
 */
export type PaymentSource = 'GATEWAY_VERIFIED' | 'COD_HANDOVER' | 'REFUND' | 'SYSTEM';

const T: Record<PaymentStatus, Partial<Record<PaymentStatus, readonly PaymentSource[]>>> = {
  UNPAID: { PENDING: ['SYSTEM'], PAID: ['COD_HANDOVER'], CANCELLED: ['SYSTEM'] },
  PENDING: { PAID: ['GATEWAY_VERIFIED'], FAILED: ['GATEWAY_VERIFIED', 'SYSTEM'], CANCELLED: ['GATEWAY_VERIFIED', 'SYSTEM'] },
  // A late, verified capture must be recorded truthfully even after we gave up
  // on the payment; the order layer then decides re-reserve vs refund.
  FAILED: { PAID: ['GATEWAY_VERIFIED'] },
  CANCELLED: { PAID: ['GATEWAY_VERIFIED'] },
  PAID: { PARTIALLY_REFUNDED: ['REFUND'], REFUNDED: ['REFUND'] },
  PARTIALLY_REFUNDED: { PARTIALLY_REFUNDED: ['REFUND'], REFUNDED: ['REFUND'] },
  REFUNDED: {},
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus, source: PaymentSource): boolean {
  return T[from][to]?.includes(source) ?? false;
}

/**
 * Applies a refund and returns the new refunded total and status.
 * Refunds can never exceed what was paid.
 */
export function applyRefund(
  paid: Poisha,
  refundedSoFar: Poisha,
  refundAmount: Poisha,
): { refunded: Poisha; status: 'PARTIALLY_REFUNDED' | 'REFUNDED' } {
  assertPoisha(paid, 'paid');
  assertPoisha(refundedSoFar, 'refundedSoFar');
  assertPoisha(refundAmount, 'refundAmount');
  if (refundAmount === 0) throw new MoneyError('Refund amount must be positive');
  const refunded = refundedSoFar + refundAmount;
  if (refunded > paid) throw new MoneyError('Refund exceeds amount paid');
  return { refunded, status: refunded === paid ? 'REFUNDED' : 'PARTIALLY_REFUNDED' };
}

export interface VerifiedTransaction {
  merchantTranId: string;
  providerTranId: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED' | 'PENDING';
  amountPoisha: Poisha;
  currency: string;
}

export interface ExpectedPayment {
  merchantTranId: string;
  amountPoisha: Poisha;
}

export type VerificationResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_SUCCESS' | 'TRAN_ID_MISMATCH' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' };

/**
 * Acceptance criteria for marking a payment PAID (API_SPECIFICATION §5).
 * Signature and duplicate checks happen before this, in the adapter and DB.
 */
export function checkVerifiedPayment(expected: ExpectedPayment, actual: VerifiedTransaction): VerificationResult {
  if (actual.merchantTranId !== expected.merchantTranId) return { ok: false, reason: 'TRAN_ID_MISMATCH' };
  if (actual.currency !== 'BDT') return { ok: false, reason: 'CURRENCY_MISMATCH' };
  if (actual.amountPoisha !== expected.amountPoisha) return { ok: false, reason: 'AMOUNT_MISMATCH' };
  if (actual.status !== 'SUCCESS') return { ok: false, reason: 'NOT_SUCCESS' };
  return { ok: true };
}
