import { describe, expect, it } from 'vitest';
import { codEligibility, computeTotals, evaluateCoupon, MinOrderNotMetError, type CouponDefinition } from './pricing.js';

const base: CouponDefinition = {
  code: 'TEST10',
  type: 'PERCENT',
  value: 1000,
  maxDiscountPoisha: null,
  minOrderPoisha: 0,
  startsAt: null,
  endsAt: null,
  active: true,
  usageLimitTotal: null,
  usedCount: 0,
  usageLimitPerCustomer: null,
  outletIds: null,
  firstOrderOnly: false,
};
const ctx = { subtotalPoisha: 50000, now: new Date('2026-11-01T06:00:00Z'), outletId: 'o1', customerUseCount: 0, isFirstOrder: true };
const rule = { deliveryFeePoisha: 6000, freeDeliveryMinPoisha: 100000, minOrderPoisha: 0 };

describe('coupons', () => {
  it('computes percent discount with cap', () => {
    expect(evaluateCoupon(base, ctx)).toEqual({ ok: true, discountPoisha: 5000, freeDelivery: false });
    expect(evaluateCoupon({ ...base, maxDiscountPoisha: 3000 }, ctx)).toEqual({ ok: true, discountPoisha: 3000, freeDelivery: false });
  });

  it('clamps fixed discount to subtotal', () => {
    expect(evaluateCoupon({ ...base, type: 'FIXED', value: 90000 }, ctx)).toEqual({ ok: true, discountPoisha: 50000, freeDelivery: false });
  });

  it('supports free-delivery coupons', () => {
    expect(evaluateCoupon({ ...base, type: 'FREE_DELIVERY', value: 0 }, ctx)).toEqual({ ok: true, discountPoisha: 0, freeDelivery: true });
  });

  it.each([
    [{ active: false }, 'INACTIVE'],
    [{ startsAt: new Date('2026-12-01') }, 'NOT_STARTED'],
    [{ endsAt: new Date('2026-11-01T06:00:00Z') }, 'EXPIRED'],
    [{ usageLimitTotal: 5, usedCount: 5 }, 'USAGE_LIMIT_REACHED'],
    [{ outletIds: ['o2'] }, 'OUTLET_NOT_ELIGIBLE'],
    [{ minOrderPoisha: 50001 }, 'MIN_ORDER_NOT_MET'],
  ] as const)('rejects %o with %s', (patch, reason) => {
    expect(evaluateCoupon({ ...base, ...patch }, ctx)).toEqual({ ok: false, reason });
  });

  it('enforces per-customer and first-order rules', () => {
    expect(evaluateCoupon({ ...base, usageLimitPerCustomer: 1 }, { ...ctx, customerUseCount: 1 })).toEqual({
      ok: false,
      reason: 'CUSTOMER_LIMIT_REACHED',
    });
    expect(evaluateCoupon({ ...base, firstOrderOnly: true }, { ...ctx, isFirstOrder: false })).toEqual({
      ok: false,
      reason: 'FIRST_ORDER_ONLY',
    });
  });
});

describe('computeTotals', () => {
  const lines = [
    { variantId: 'milk-1l', unitPricePoisha: 9000, quantity: 2 },
    { variantId: 'doi-500g', unitPricePoisha: 12000, quantity: 1 },
  ];

  it('adds delivery fee below the free threshold', () => {
    const t = computeTotals(lines, rule, null);
    expect(t.subtotalPoisha).toBe(30000);
    expect(t.deliveryFeePoisha).toBe(6000);
    expect(t.totalPoisha).toBe(36000);
    expect(t.lines.map((l) => l.lineTotalPoisha)).toEqual([18000, 12000]);
  });

  it('waives delivery exactly at the threshold, not one poisha below', () => {
    expect(computeTotals(lines, { ...rule, freeDeliveryMinPoisha: 30000 }, null).deliveryFeePoisha).toBe(0);
    expect(computeTotals(lines, { ...rule, freeDeliveryMinPoisha: 30001 }, null).deliveryFeePoisha).toBe(6000);
  });

  it('checks free threshold after discount and allocates discount to lines', () => {
    const t = computeTotals(lines, { ...rule, freeDeliveryMinPoisha: 30000 }, { ok: true, discountPoisha: 3000, freeDelivery: false });
    expect(t.deliveryFeePoisha).toBe(6000);
    expect(t.totalPoisha).toBe(33000);
    expect(t.lines.map((l) => l.discountAllocatedPoisha)).toEqual([1800, 1200]);
  });

  it('applies free-delivery coupon', () => {
    expect(computeTotals(lines, rule, { ok: true, discountPoisha: 0, freeDelivery: true }).totalPoisha).toBe(30000);
  });

  it('ignores rejected coupons', () => {
    expect(computeTotals(lines, rule, { ok: false, reason: 'EXPIRED' }).discountPoisha).toBe(0);
  });

  it('enforces minimum order before discount', () => {
    expect(() => computeTotals(lines, { ...rule, minOrderPoisha: 30001 }, null)).toThrow(MinOrderNotMetError);
    expect(() => computeTotals([], rule, null)).toThrow('Cart is empty');
  });

  it('never has a null free threshold waive delivery', () => {
    expect(computeTotals(lines, { ...rule, freeDeliveryMinPoisha: null }, null).deliveryFeePoisha).toBe(6000);
  });
});

describe('COD eligibility', () => {
  const r = { codEnabled: true, codMaxOrderPoisha: 300000 };
  const c = { totalPoisha: 300000, customerFailedDeliveries: 0, failedDeliveryBlockThreshold: 2 };
  it('allows within limits (boundary inclusive)', () => expect(codEligibility(r, c)).toEqual({ eligible: true }));
  it('rejects disabled', () => expect(codEligibility({ ...r, codEnabled: false }, c)).toEqual({ eligible: false, reason: 'DISABLED' }));
  it('rejects over max', () =>
    expect(codEligibility(r, { ...c, totalPoisha: 300001 })).toEqual({ eligible: false, reason: 'ORDER_TOO_LARGE' }));
  it('blocks repeat failures', () =>
    expect(codEligibility(r, { ...c, customerFailedDeliveries: 2 })).toEqual({ eligible: false, reason: 'CUSTOMER_BLOCKED' }));
  it('no max and no block threshold', () =>
    expect(codEligibility({ codEnabled: true, codMaxOrderPoisha: null }, { ...c, failedDeliveryBlockThreshold: null, customerFailedDeliveries: 9 })).toEqual({
      eligible: true,
    }));
});
