import { allocateProportionally, assertPoisha, multiply, percentOfBp, sum, type Poisha } from './money.js';

export interface PriceLine {
  variantId: string;
  unitPricePoisha: Poisha;
  quantity: number;
}

export interface DeliveryRule {
  deliveryFeePoisha: Poisha;
  /** Free delivery when goods total after discount is at least this. null = never free. */
  freeDeliveryMinPoisha: Poisha | null;
  minOrderPoisha: Poisha;
}

export type CouponType = 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';

export interface CouponDefinition {
  code: string;
  type: CouponType;
  /** PERCENT: basis points. FIXED: poisha. FREE_DELIVERY: ignored. */
  value: number;
  maxDiscountPoisha: Poisha | null;
  minOrderPoisha: Poisha;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  usageLimitTotal: number | null;
  usedCount: number;
  usageLimitPerCustomer: number | null;
  /** null = valid at all outlets. */
  outletIds: readonly string[] | null;
  firstOrderOnly: boolean;
}

export interface CouponContext {
  subtotalPoisha: Poisha;
  now: Date;
  outletId: string;
  customerUseCount: number;
  isFirstOrder: boolean;
}

export type CouponRejection =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'MIN_ORDER_NOT_MET'
  | 'OUTLET_NOT_ELIGIBLE'
  | 'FIRST_ORDER_ONLY';

export type CouponEvaluation =
  | { ok: true; discountPoisha: Poisha; freeDelivery: boolean }
  | { ok: false; reason: CouponRejection };

export function evaluateCoupon(coupon: CouponDefinition, ctx: CouponContext): CouponEvaluation {
  if (!coupon.active) return { ok: false, reason: 'INACTIVE' };
  if (coupon.startsAt && ctx.now < coupon.startsAt) return { ok: false, reason: 'NOT_STARTED' };
  if (coupon.endsAt && ctx.now >= coupon.endsAt) return { ok: false, reason: 'EXPIRED' };
  if (coupon.usageLimitTotal !== null && coupon.usedCount >= coupon.usageLimitTotal) {
    return { ok: false, reason: 'USAGE_LIMIT_REACHED' };
  }
  if (coupon.usageLimitPerCustomer !== null && ctx.customerUseCount >= coupon.usageLimitPerCustomer) {
    return { ok: false, reason: 'CUSTOMER_LIMIT_REACHED' };
  }
  if (coupon.firstOrderOnly && !ctx.isFirstOrder) return { ok: false, reason: 'FIRST_ORDER_ONLY' };
  if (coupon.outletIds !== null && !coupon.outletIds.includes(ctx.outletId)) {
    return { ok: false, reason: 'OUTLET_NOT_ELIGIBLE' };
  }
  if (ctx.subtotalPoisha < coupon.minOrderPoisha) return { ok: false, reason: 'MIN_ORDER_NOT_MET' };

  let discount = 0;
  if (coupon.type === 'PERCENT') discount = percentOfBp(ctx.subtotalPoisha, coupon.value);
  if (coupon.type === 'FIXED') {
    assertPoisha(coupon.value, 'coupon.value');
    discount = coupon.value;
  }
  if (coupon.maxDiscountPoisha !== null) discount = Math.min(discount, coupon.maxDiscountPoisha);
  discount = Math.min(discount, ctx.subtotalPoisha); // never below zero goods total
  return { ok: true, discountPoisha: discount, freeDelivery: coupon.type === 'FREE_DELIVERY' };
}

export interface OrderTotals {
  lines: (PriceLine & { lineTotalPoisha: Poisha; discountAllocatedPoisha: Poisha })[];
  subtotalPoisha: Poisha;
  discountPoisha: Poisha;
  deliveryFeePoisha: Poisha;
  totalPoisha: Poisha;
}

export class MinOrderNotMetError extends Error {
  readonly code = 'MIN_ORDER_NOT_MET';
  constructor(readonly minOrderPoisha: Poisha) {
    super('Minimum order value not met');
    this.name = 'MinOrderNotMetError';
  }
}

/**
 * Server-side total calculation. Prices come from the database, never from
 * the client. Minimum order is checked against the subtotal before discount.
 * Free-delivery threshold is checked against the subtotal after discount.
 */
export function computeTotals(
  lines: readonly PriceLine[],
  rule: DeliveryRule,
  coupon: CouponEvaluation | null,
): OrderTotals {
  if (lines.length === 0) throw new Error('Cart is empty');
  const lineTotals = lines.map((l) => multiply(l.unitPricePoisha, l.quantity));
  const subtotal = sum(lineTotals);
  if (subtotal < rule.minOrderPoisha) throw new MinOrderNotMetError(rule.minOrderPoisha);

  const discount = coupon?.ok ? coupon.discountPoisha : 0;
  const goodsAfterDiscount = subtotal - discount;
  const freeByThreshold = rule.freeDeliveryMinPoisha !== null && goodsAfterDiscount >= rule.freeDeliveryMinPoisha;
  const freeByCoupon = coupon?.ok === true && coupon.freeDelivery;
  const deliveryFee = freeByThreshold || freeByCoupon ? 0 : rule.deliveryFeePoisha;
  assertPoisha(deliveryFee, 'deliveryFee');

  const allocations = allocateProportionally(discount, lineTotals);
  return {
    lines: lines.map((l, i) => ({
      ...l,
      lineTotalPoisha: lineTotals[i] ?? 0,
      discountAllocatedPoisha: allocations[i] ?? 0,
    })),
    subtotalPoisha: subtotal,
    discountPoisha: discount,
    deliveryFeePoisha: deliveryFee,
    totalPoisha: goodsAfterDiscount + deliveryFee,
  };
}

export interface CodRule {
  codEnabled: boolean;
  codMaxOrderPoisha: Poisha | null;
}

export interface CodContext {
  totalPoisha: Poisha;
  customerFailedDeliveries: number;
  /** Block COD after this many failed deliveries. null = never block. */
  failedDeliveryBlockThreshold: number | null;
}

export type CodEligibility = { eligible: true } | { eligible: false; reason: 'DISABLED' | 'ORDER_TOO_LARGE' | 'CUSTOMER_BLOCKED' };

export function codEligibility(rule: CodRule, ctx: CodContext): CodEligibility {
  if (!rule.codEnabled) return { eligible: false, reason: 'DISABLED' };
  if (rule.codMaxOrderPoisha !== null && ctx.totalPoisha > rule.codMaxOrderPoisha) {
    return { eligible: false, reason: 'ORDER_TOO_LARGE' };
  }
  if (ctx.failedDeliveryBlockThreshold !== null && ctx.customerFailedDeliveries >= ctx.failedDeliveryBlockThreshold) {
    return { eligible: false, reason: 'CUSTOMER_BLOCKED' };
  }
  return { eligible: true };
}
