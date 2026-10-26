import { describe, expect, it } from 'vitest';
import {
  allowedOrderTransitions,
  assertOrderTransition,
  canTransitionOrder,
  holdsReservation,
  InvalidTransitionError,
  isTerminalOrderStatus,
  ORDER_STATUSES,
} from './order-state.js';
import { applyRefund, canTransitionPayment, checkVerifiedPayment, PAYMENT_STATUSES } from './payment-state.js';
import { MoneyError } from './money.js';

describe('order state machine', () => {
  it('follows the happy path', () => {
    assertOrderTransition('PENDING_PAYMENT', 'PLACED', 'SYSTEM');
    assertOrderTransition('PLACED', 'CONFIRMED', 'STAFF');
    assertOrderTransition('CONFIRMED', 'PREPARING', 'STAFF');
    assertOrderTransition('PREPARING', 'READY_FOR_DISPATCH', 'STAFF');
    assertOrderTransition('READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'STAFF');
    assertOrderTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'RIDER');
  });

  it('never lets a customer or rider mark an order placed (payment must be verified)', () => {
    expect(canTransitionOrder('PENDING_PAYMENT', 'PLACED', 'CUSTOMER')).toBe(false);
    expect(canTransitionOrder('PENDING_PAYMENT', 'PLACED', 'STAFF')).toBe(false);
  });

  it('allows customer cancellation only up to CONFIRMED', () => {
    expect(canTransitionOrder('PLACED', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransitionOrder('CONFIRMED', 'CANCELLED', 'CUSTOMER')).toBe(true);
    expect(canTransitionOrder('PREPARING', 'CANCELLED', 'CUSTOMER')).toBe(false);
    expect(canTransitionOrder('OUT_FOR_DELIVERY', 'CANCELLED', 'STAFF')).toBe(false);
  });

  it('supports failed delivery reschedule and close', () => {
    expect(canTransitionOrder('OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'RIDER')).toBe(true);
    expect(canTransitionOrder('DELIVERY_FAILED', 'READY_FOR_DISPATCH', 'STAFF')).toBe(true);
    expect(canTransitionOrder('DELIVERY_FAILED', 'CANCELLED', 'STAFF')).toBe(true);
    expect(canTransitionOrder('DELIVERY_FAILED', 'DELIVERED', 'RIDER')).toBe(false);
  });

  it('keeps terminal states immutable', () => {
    for (const terminal of ['DELIVERED', 'CANCELLED', 'REJECTED'] as const) {
      expect(isTerminalOrderStatus(terminal)).toBe(true);
      for (const to of ORDER_STATUSES) {
        for (const actor of ['CUSTOMER', 'STAFF', 'RIDER', 'SYSTEM'] as const) {
          expect(canTransitionOrder(terminal, to, actor)).toBe(false);
        }
      }
    }
  });

  it('allows only the system to recover an expired order', () => {
    expect(allowedOrderTransitions('EXPIRED', 'SYSTEM')).toEqual(['PLACED']);
    expect(allowedOrderTransitions('EXPIRED', 'STAFF')).toEqual([]);
  });

  it('throws a typed error for invalid transitions', () => {
    expect(() => assertOrderTransition('PLACED', 'DELIVERED', 'STAFF')).toThrow(InvalidTransitionError);
  });

  it('knows which statuses hold reservations', () => {
    expect(holdsReservation('PENDING_PAYMENT')).toBe(true);
    expect(holdsReservation('DELIVERY_FAILED')).toBe(true);
    expect(holdsReservation('OUT_FOR_DELIVERY')).toBe(false); // stock already committed
    expect(holdsReservation('CANCELLED')).toBe(false);
  });
});

describe('payment state machine', () => {
  it('marks online payments PAID only from gateway verification', () => {
    expect(canTransitionPayment('PENDING', 'PAID', 'GATEWAY_VERIFIED')).toBe(true);
    expect(canTransitionPayment('PENDING', 'PAID', 'SYSTEM')).toBe(false);
    expect(canTransitionPayment('UNPAID', 'PAID', 'GATEWAY_VERIFIED')).toBe(false);
  });

  it('marks COD paid only on handover', () => {
    expect(canTransitionPayment('UNPAID', 'PAID', 'COD_HANDOVER')).toBe(true);
    expect(canTransitionPayment('UNPAID', 'PAID', 'SYSTEM')).toBe(false);
  });

  it('records late verified captures truthfully', () => {
    expect(canTransitionPayment('CANCELLED', 'PAID', 'GATEWAY_VERIFIED')).toBe(true);
    expect(canTransitionPayment('FAILED', 'PAID', 'GATEWAY_VERIFIED')).toBe(true);
    expect(canTransitionPayment('FAILED', 'PAID', 'SYSTEM')).toBe(false);
  });

  it('treats REFUNDED as terminal', () => {
    for (const to of PAYMENT_STATUSES) expect(canTransitionPayment('REFUNDED', to, 'REFUND')).toBe(false);
  });

  it('applies refunds without exceeding the paid amount', () => {
    expect(applyRefund(10000, 0, 4000)).toEqual({ refunded: 4000, status: 'PARTIALLY_REFUNDED' });
    expect(applyRefund(10000, 4000, 6000)).toEqual({ refunded: 10000, status: 'REFUNDED' });
    expect(() => applyRefund(10000, 4000, 6001)).toThrow(MoneyError);
    expect(() => applyRefund(10000, 0, 0)).toThrow(MoneyError);
  });

  describe('verification check', () => {
    const expected = { merchantTranId: 'DW-1', amountPoisha: 50000 };
    const ok = { merchantTranId: 'DW-1', providerTranId: 'P-9', status: 'SUCCESS' as const, amountPoisha: 50000, currency: 'BDT' };
    it('accepts a matching success', () => expect(checkVerifiedPayment(expected, ok)).toEqual({ ok: true }));
    it('rejects amount mismatch', () =>
      expect(checkVerifiedPayment(expected, { ...ok, amountPoisha: 49999 })).toEqual({ ok: false, reason: 'AMOUNT_MISMATCH' }));
    it('rejects other currencies', () =>
      expect(checkVerifiedPayment(expected, { ...ok, currency: 'USD' })).toEqual({ ok: false, reason: 'CURRENCY_MISMATCH' }));
    it('rejects foreign transaction ids', () =>
      expect(checkVerifiedPayment(expected, { ...ok, merchantTranId: 'DW-2' })).toEqual({ ok: false, reason: 'TRAN_ID_MISMATCH' }));
    it('rejects non-success', () =>
      expect(checkVerifiedPayment(expected, { ...ok, status: 'PENDING' })).toEqual({ ok: false, reason: 'NOT_SUCCESS' }));
  });
});
