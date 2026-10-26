import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  candidatesForWindow,
  codEligibility,
  computeTotals,
  evaluateCoupon,
  evaluateOutlets,
  MinOrderNotMetError,
  slotWindows,
  type CouponDefinition,
  type CouponEvaluation,
  type EligibilityResult,
  type OrderTotals,
  type OutletSnapshot,
} from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { randomInt } from 'node:crypto';
import { hmacHex, newId } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { CartService } from '../cart/cart.service.js';
import { dhakaDate, addDays } from '../delivery/slots.js';
import type { Coupon, OutletZoneRule } from '../generated/prisma/client.js';

export type PaymentMethod = 'ONLINE' | 'COD';

export interface ShipAddress {
  recipientName: string;
  phone: string;
  areaId: string;
  line1: string;
  line2?: string | null;
  landmark?: string | null;
  instructions?: string | null;
}

interface Snapshot {
  outlets: OutletSnapshot[];
  rules: Map<string, OutletZoneRule>;
}

interface PricedOption {
  outletId: string;
  slotId: string;
  totals: OrderTotals;
  coupon: (Coupon & { evaluation: CouponEvaluation }) | null;
  codEligible: boolean;
}

/**
 * Checkout (APP_FLOW §1, §2.3; TRD §5.5). Everything is recomputed on the
 * server from the database; the client only chooses an area, a slot window
 * and a payment method. Placement is one transaction: stock, slot and coupon
 * are claimed with conditional updates, trying eligible outlets in ranked
 * order and rolling back to a savepoint between attempts.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(CartService) private readonly carts: CartService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── snapshot & eligibility ─────────────

  private async snapshot(tx: Tx, areaId: string, variantIds: string[]): Promise<Snapshot> {
    const horizon = await this.settings.get('delivery.bookingHorizonDays', null, tx);
    const now = this.clock.now();
    const until = new Date(`${addDays(dhakaDate(now), horizon + 1)}T00:00:00+06:00`);
    const outlets = await tx.outlet.findMany({
      where: { zoneRules: { some: { zone: { active: true, areas: { some: { areaId, area: { active: true } } } } } } },
      include: {
        zoneRules: { where: { zone: { active: true, areas: { some: { areaId } } } }, orderBy: { priority: 'asc' } },
        inventory: { where: { productVariantId: { in: variantIds } } },
        slots: { where: { startsAt: { gt: now, lt: until } } },
      },
    });
    const rules = new Map<string, OutletZoneRule>();
    const snaps: OutletSnapshot[] = outlets.map((o) => {
      const rule = o.zoneRules.find((r) => r.active) ?? null;
      if (rule) rules.set(o.id, rule);
      return {
        outletId: o.id,
        code: o.code,
        status: o.status,
        acceptsOnlineOrders: o.acceptsOnlineOrders,
        zoneRule: rule ? { active: true, priority: rule.priority, minOrderPoisha: rule.minOrderPoisha } : null,
        stock: new Map(o.inventory.map((i) => [i.productVariantId, { onHand: i.quantityOnHand, reserved: i.reservedQuantity, onlineBuffer: i.onlineBufferQty, isListed: i.isListed }])),
        slots: o.slots.map((s) => ({ slotId: s.id, startsAt: s.startsAt, endsAt: s.endsAt, cutoffAt: s.cutoffAt, capacity: s.capacity, bookedCount: s.bookedCount, status: s.status })),
      };
    });
    return { outlets: snaps, rules };
  }

  private async cartLines(tx: Tx, cartId: string) {
    const items = await tx.cartItem.findMany({ where: { cartId }, include: { variant: { include: { product: true } } } });
    if (items.length === 0) throw new AppError('VALIDATION_FAILED', 'আপনার কার্ট খালি');
    const inactive = items.filter((i) => i.variant.status !== 'ACTIVE' || i.variant.product.status !== 'ACTIVE');
    if (inactive.length) throw new AppError('OUT_OF_STOCK', 'কিছু পণ্য আর পাওয়া যাচ্ছে না', inactive.map((i) => ({ variantId: i.productVariantId, available: 0 })));
    return items.map((i) => ({ variantId: i.productVariantId, quantity: i.quantity, unitPricePoisha: i.variant.pricePoisha, item: i }));
  }

  private assertArea = async (tx: Tx, areaId: string) => {
    if (!(await tx.area.findFirst({ where: { id: areaId, active: true } }))) throw new AppError('AREA_NOT_SERVICEABLE', 'এই এলাকায় এখনো ডেলিভারি দেওয়া হয় না');
  };

  async quote(cartId: string, areaId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertArea(tx, areaId);
      const lines = await this.cartLines(tx, cartId);
      const snap = await this.snapshot(tx, areaId, lines.map((l) => l.variantId));
      const subtotal = lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
      const e = evaluateOutlets(snap.outlets, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), subtotal, this.clock.now());
      return this.describeQuote(e, snap, subtotal);
    });
  }

  private describeQuote(e: EligibilityResult, snap: Snapshot, subtotal: number) {
    const serviceable = snap.outlets.some((o) => o.status === 'ACTIVE' && o.acceptsOnlineOrders && o.zoneRule);
    const windows = slotWindows(e.eligible).map((w) => {
      const remaining = Math.max(
        ...e.eligible.flatMap((o) => o.openSlots.filter((s) => +s.startsAt === +w.startsAt && +s.endsAt === +w.endsAt).map((s) => s.capacity - s.bookedCount)),
      );
      return { slotKey: w.slotKey, startsAt: w.startsAt, endsAt: w.endsAt, remaining: remaining <= 2 ? 'FEW' : 'AVAILABLE' };
    });
    const minOrders = e.excluded.filter((x) => x.reason === 'MIN_ORDER_NOT_MET').map((x) => snap.rules.get(x.outletId)?.minOrderPoisha ?? 0);
    const blocking = new Set<string>();
    if (e.eligible.length === 0) for (const x of e.excluded) for (const v of x.blockingVariantIds ?? []) blocking.add(v);
    return {
      serviceable,
      slots: windows,
      noSingleOutlet: e.noSingleOutlet,
      unavailableEverywhere: e.unavailableEverywhere,
      blockingVariantIds: [...blocking],
      minOrderPoisha: e.eligible.length === 0 && minOrders.length ? Math.min(...minOrders) : null,
      subtotalPoisha: subtotal,
      reason: !serviceable ? 'AREA_NOT_SERVICEABLE' : e.eligible.length > 0 ? null : e.noSingleOutlet ? 'NO_SINGLE_OUTLET' : minOrders.length ? 'MIN_ORDER_NOT_MET' : blocking.size ? 'OUT_OF_STOCK' : 'NO_SLOTS',
    };
  }

  // ───────────── pricing ─────────────

  private async loadCoupon(tx: Tx, code: string | null | undefined): Promise<Coupon | null> {
    if (!code) return null;
    const c = await tx.coupon.findUnique({ where: { code } });
    if (!c) throw new AppError('COUPON_INVALID', 'কুপনটি সঠিক নয়', { reason: 'NOT_FOUND' });
    return c;
  }

  private async priceFor(tx: Tx, customerId: string | null, outletId: string, rule: OutletZoneRule, lines: { variantId: string; quantity: number; unitPricePoisha: number }[], coupon: Coupon | null): Promise<Omit<PricedOption, 'slotId'>> {
    const subtotal = lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
    let evaluation: CouponEvaluation | null = null;
    if (coupon) {
      const def: CouponDefinition = { ...coupon, outletIds: coupon.outletIds.length ? coupon.outletIds : null };
      const [uses, orders] = customerId
        ? await Promise.all([
            tx.couponRedemption.count({ where: { couponId: coupon.id, userId: customerId, status: { in: ['RESERVED', 'CONFIRMED'] } } }),
            tx.order.count({ where: { userId: customerId, status: { notIn: ['CANCELLED', 'EXPIRED', 'REJECTED'] } } }),
          ])
        : [0, 0];
      evaluation = evaluateCoupon(def, { subtotalPoisha: subtotal, now: this.clock.now(), outletId, customerUseCount: uses, isFirstOrder: orders === 0 });
      if (!evaluation.ok) throw new AppError('COUPON_INVALID', 'কুপনটি এই অর্ডারে প্রযোজ্য নয়', { reason: evaluation.reason });
    }
    let totals: OrderTotals;
    try {
      totals = computeTotals(lines.map((l) => ({ variantId: l.variantId, unitPricePoisha: l.unitPricePoisha, quantity: l.quantity })), { deliveryFeePoisha: rule.deliveryFeePoisha, freeDeliveryMinPoisha: rule.freeDeliveryMinPoisha, minOrderPoisha: rule.minOrderPoisha }, evaluation);
    } catch (e) {
      if (e instanceof MinOrderNotMetError) throw new AppError('MIN_ORDER_NOT_MET', 'ন্যূনতম অর্ডারের পরিমাণ পূরণ হয়নি', { minOrderPoisha: e.minOrderPoisha });
      throw e;
    }
    const failedThreshold = await this.settings.get('cod.failedDeliveryBlockThreshold', null, tx);
    const failed = customerId ? await tx.order.count({ where: { userId: customerId, delivery: { attempts: { some: { outcome: { not: 'DELIVERED' } } } } } }) : 0;
    const cod = codEligibility({ codEnabled: rule.codEnabled, codMaxOrderPoisha: rule.codMaxOrderPoisha }, { totalPoisha: totals.totalPoisha, customerFailedDeliveries: failed, failedDeliveryBlockThreshold: failedThreshold });
    return { outletId, totals, coupon: coupon && evaluation ? { ...coupon, evaluation } : null, codEligible: cod.eligible };
  }

  quoteHash(totals: OrderTotals, slotKey: string, method: PaymentMethod): string {
    const material = JSON.stringify({ l: totals.lines.map((l) => [l.variantId, l.quantity, l.unitPricePoisha]), s: totals.subtotalPoisha, d: totals.discountPoisha, f: totals.deliveryFeePoisha, t: totals.totalPoisha, slotKey, method });
    return hmacHex(this.env.SESSION_SECRET, `quote:${material}`);
  }

  async price(cartId: string, customerId: string | null, input: { areaId: string; slotKey: string; paymentMethod: PaymentMethod; couponCode?: string | null }) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertArea(tx, input.areaId);
      const lines = await this.cartLines(tx, cartId);
      const snap = await this.snapshot(tx, input.areaId, lines.map((l) => l.variantId));
      const subtotal = lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
      const e = evaluateOutlets(snap.outlets, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), subtotal, this.clock.now());
      const cand = candidatesForWindow(e.eligible, input.slotKey)[0];
      if (!cand) throw new AppError('SLOT_FULL', 'এই সময়টি আর পাওয়া যাচ্ছে না', this.describeQuote(e, snap, subtotal));
      const opt = await this.priceFor(tx, customerId, cand.outletId, snap.rules.get(cand.outletId) as OutletZoneRule, lines, await this.loadCoupon(tx, input.couponCode));
      return {
        subtotalPoisha: opt.totals.subtotalPoisha,
        discountPoisha: opt.totals.discountPoisha,
        deliveryFeePoisha: opt.totals.deliveryFeePoisha,
        totalPoisha: opt.totals.totalPoisha,
        codEligible: opt.codEligible,
        paymentMethods: [...(await this.settings.get('payments.online.enabled', null, tx) ? (['ONLINE'] as const) : []), ...(opt.codEligible ? (['COD'] as const) : [])],
        quoteHash: this.quoteHash(opt.totals, input.slotKey, input.paymentMethod),
      };
    });
  }

  // ───────────── placement ─────────────

  async place(
    customerId: string,
    cartId: string,
    idempotencyKey: string,
    input: { address: ShipAddress; slotKey: string; paymentMethod: PaymentMethod; couponCode?: string | null; quoteHash: string; acceptedPolicyVersion: string; saveAddress?: boolean },
    req: Request,
  ): Promise<{ orderId: string; orderNumber: string; status: string; paymentStatus: string; paymentId: string | null; next: 'REDIRECT' | 'CONFIRMATION'; replayed: boolean }> {
    const existing = await this.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId: customerId, idempotencyKey } }, include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (existing) return this.placedResult(existing, existing.payments[0]?.id ?? null, true);

    if (input.paymentMethod === 'ONLINE' && !(await this.settings.get('payments.online.enabled'))) throw new AppError('VALIDATION_FAILED', 'অনলাইন পেমেন্ট এখন চালু নেই');
    const maxPending = await this.settings.get('orders.maxPendingPaymentPerCustomer');
    if (input.paymentMethod === 'ONLINE' && (await this.prisma.order.count({ where: { userId: customerId, status: 'PENDING_PAYMENT' } })) >= maxPending) {
      throw new AppError('RATE_LIMITED', 'আগের অর্ডারের পেমেন্ট সম্পন্ন করুন বা বাতিল করুন');
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const area = await tx.area.findFirst({ where: { id: input.address.areaId, active: true } });
        if (!area) throw new AppError('AREA_NOT_SERVICEABLE', 'এই এলাকায় এখনো ডেলিভারি দেওয়া হয় না');
        const lines = await this.cartLines(tx, cartId);
        const snap = await this.snapshot(tx, area.id, lines.map((l) => l.variantId));
        const subtotal = lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
        const e = evaluateOutlets(snap.outlets, lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })), subtotal, this.clock.now());
        if (e.eligible.length === 0) {
          const q = this.describeQuote(e, snap, subtotal);
          if (q.reason === 'AREA_NOT_SERVICEABLE') throw new AppError('AREA_NOT_SERVICEABLE', 'এই এলাকায় এখনো ডেলিভারি দেওয়া হয় না', q);
          if (q.reason === 'NO_SINGLE_OUTLET') throw new AppError('NO_SINGLE_OUTLET', 'এই সব পণ্য একসাথে একটি আউটলেট থেকে পাঠানো সম্ভব নয়', q);
          if (q.reason === 'MIN_ORDER_NOT_MET') throw new AppError('MIN_ORDER_NOT_MET', 'ন্যূনতম অর্ডারের পরিমাণ পূরণ হয়নি', q);
          if (q.reason === 'OUT_OF_STOCK') throw new AppError('OUT_OF_STOCK', 'কিছু পণ্য স্টকে নেই', q);
          throw new AppError('SLOT_FULL', 'ডেলিভারির কোনো সময় খালি নেই', q);
        }
        const candidates = candidatesForWindow(e.eligible, input.slotKey);
        if (candidates.length === 0) throw new AppError('SLOT_FULL', 'এই সময়টি আর পাওয়া যাচ্ছে না', this.describeQuote(e, snap, subtotal));
        const coupon = await this.loadCoupon(tx, input.couponCode);
        const holdMinutes = await this.settings.get('payments.holdMinutes', null, tx);
        const paymentExpiresAt = input.paymentMethod === 'ONLINE' ? new Date(this.clock.now().getTime() + holdMinutes * 60_000) : null;

        const orderId = newId();
        let chosen: PricedOption | null = null;
        for (const c of candidates) {
          await tx.$executeRaw`SAVEPOINT outlet_attempt`;
          try {
            const booked = await tx.$queryRaw<{ id: string }[]>`
              UPDATE delivery_slot SET booked_count = booked_count + 1
              WHERE id = ${c.slotId}::uuid AND outlet_id = ${c.outletId}::uuid AND status = 'OPEN'
                AND cutoff_at > ${this.clock.now()} AND booked_count < capacity
              RETURNING id`;
            if (booked.length === 0) throw new AppError('SLOT_FULL', 'slot taken');
            // Order row must exist before stock movements reference it.
            await this.createOrderShell(tx, orderId, customerId, c.outletId, c.slotId, idempotencyKey, input, area.nameBn, paymentExpiresAt);
            await this.inventory.reserveLines(tx, c.outletId, lines.map((l) => ({ variantId: l.variantId, qty: l.quantity })), orderId);
            chosen = { ...(await this.priceFor(tx, customerId, c.outletId, snap.rules.get(c.outletId) as OutletZoneRule, lines, coupon)), slotId: c.slotId };
            await tx.$executeRaw`RELEASE SAVEPOINT outlet_attempt`;
            break;
          } catch (err) {
            await tx.$executeRaw`ROLLBACK TO SAVEPOINT outlet_attempt`;
            const code = (err as { code?: string }).code;
            if (code !== 'SLOT_FULL' && code !== 'OUT_OF_STOCK') throw err;
          }
        }
        if (!chosen) throw new AppError('SLOT_FULL', 'এই সময়টি বা পণ্যগুলো এইমাত্র শেষ হয়ে গেছে', this.describeQuote(e, snap, subtotal));

        const totals = chosen.totals;
        if (this.quoteHash(totals, input.slotKey, input.paymentMethod) !== input.quoteHash) {
          throw new AppError('PRICE_CHANGED', 'দাম বা খরচ পরিবর্তিত হয়েছে, আবার দেখুন', {
            subtotalPoisha: totals.subtotalPoisha,
            discountPoisha: totals.discountPoisha,
            deliveryFeePoisha: totals.deliveryFeePoisha,
            totalPoisha: totals.totalPoisha,
            quoteHash: this.quoteHash(totals, input.slotKey, input.paymentMethod),
          });
        }
        if (input.paymentMethod === 'COD' && !chosen.codEligible) throw new AppError('COD_NOT_ELIGIBLE', 'এই অর্ডারে ক্যাশ অন ডেলিভারি পাওয়া যাবে না');

        if (chosen.coupon) {
          const ok = await tx.$queryRaw<{ id: string }[]>`
            UPDATE coupon SET used_count = used_count + 1
            WHERE id = ${chosen.coupon.id}::uuid AND active AND (usage_limit_total IS NULL OR used_count < usage_limit_total)
            RETURNING id`;
          if (ok.length === 0) throw new AppError('COUPON_INVALID', 'কুপনের ব্যবহারসীমা শেষ', { reason: 'USAGE_LIMIT_REACHED' });
          await tx.couponRedemption.create({ data: { id: newId(), couponId: chosen.coupon.id, orderId, userId: customerId, discountPoisha: totals.discountPoisha } });
        }

        const now = this.clock.now();
        await tx.order.update({
          where: { id: orderId },
          data: {
            subtotalPoisha: totals.subtotalPoisha,
            discountPoisha: totals.discountPoisha,
            deliveryFeePoisha: totals.deliveryFeePoisha,
            totalPoisha: totals.totalPoisha,
            couponId: chosen.coupon?.id ?? null,
            couponCode: chosen.coupon?.code ?? null,
            status: input.paymentMethod === 'COD' ? 'PLACED' : 'PENDING_PAYMENT',
            placedAt: input.paymentMethod === 'COD' ? now : null,
            paymentExpiresAt,
          },
        });
        const variants = new Map(lines.map((l) => [l.variantId, l.item.variant]));
        await tx.orderItem.createMany({
          data: totals.lines.map((l) => {
            const v = variants.get(l.variantId);
            if (!v) throw new Error('variant missing');
            return {
              id: newId(),
              orderId,
              productVariantId: v.id,
              productNameBn: v.product.nameBn,
              productNameEn: v.product.nameEn,
              variantLabelBn: v.labelBn,
              sku: v.sku,
              unitPricePoisha: l.unitPricePoisha,
              quantity: l.quantity,
              lineTotalPoisha: l.lineTotalPoisha,
              discountAllocatedPoisha: l.discountAllocatedPoisha,
            };
          }),
        });
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        const payment = await tx.payment.create({
          data: {
            id: newId(),
            orderId,
            method: input.paymentMethod,
            provider: input.paymentMethod === 'ONLINE' ? this.env.PAYMENTS_PROVIDER : null,
            status: 'UNPAID',
            amountPoisha: totals.totalPoisha,
            merchantTranId: `${order.orderNumber}-${input.paymentMethod === 'COD' ? 'COD' : '1'}`,
          },
        });
        const delivery = await tx.delivery.create({ data: { id: newId(), orderId, outletId: chosen.outletId } });
        if (input.paymentMethod === 'COD') {
          await tx.codCollection.create({ data: { id: newId(), deliveryId: delivery.id, outletId: chosen.outletId, expectedPoisha: totals.totalPoisha } });
        }
        await tx.orderStatusEvent.create({ data: { id: newId(), orderId, fromStatus: null, toStatus: order.status, actorUserId: customerId, actorRole: 'CUSTOMER', createdAt: now } });
        await this.audit.record({ action: 'order.place', entityType: 'order', entityId: orderId, outletId: chosen.outletId, after: { totalPoisha: totals.totalPoisha, method: input.paymentMethod } }, { userId: customerId, actorRole: 'CUSTOMER' }, req, tx);

        if (input.saveAddress) {
          const has = await tx.address.count({ where: { userId: customerId } });
          await tx.address.create({ data: { id: newId(), userId: customerId, ...input.address, isDefault: has === 0 } });
        }
        await this.carts.clear(cartId, tx);

        if (input.paymentMethod === 'COD') {
          await this.notifications.orderEvent(tx, orderId, 'PLACED');
          const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: chosen.outletId } });
          if (outlet.autoConfirmOrders) {
            await this.orders.transitionInTx(tx, { orderId, to: 'CONFIRMED', actor: 'SYSTEM', actorUserId: null, actorRole: 'SYSTEM', reason: 'auto-confirm' }, req);
          }
        }
        const final = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        return { order: final, paymentId: payment.id };
      },
      { timeout: 30_000 },
    );
    return this.placedResult(result.order, result.paymentId, false);
  }

  private placedResult(o: { id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: string }, paymentId: string | null, replayed: boolean) {
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentId,
      next: (o.paymentMethod === 'ONLINE' && o.status === 'PENDING_PAYMENT' ? 'REDIRECT' : 'CONFIRMATION') as 'REDIRECT' | 'CONFIRMATION',
      replayed,
    };
  }

  /** Minimal order row with the address snapshot; money fields are filled once an outlet is secured. */
  private async createOrderShell(tx: Tx, id: string, userId: string, outletId: string, slotId: string, idempotencyKey: string, input: { address: ShipAddress; paymentMethod: PaymentMethod; acceptedPolicyVersion: string }, areaNameBn: string, paymentExpiresAt: Date | null) {
    const slot = await tx.deliverySlot.findUniqueOrThrow({ where: { id: slotId } });
    await tx.order.create({
      data: {
        id,
        orderNumber: orderNumber(this.clock.now()),
        userId,
        outletId,
        status: 'PENDING_PAYMENT',
        paymentMethod: input.paymentMethod,
        paymentStatus: 'UNPAID',
        deliverySlotId: slotId,
        slotStartsAt: slot.startsAt,
        slotEndsAt: slot.endsAt,
        areaId: input.address.areaId,
        shipName: input.address.recipientName,
        shipPhone: input.address.phone,
        shipLine1: input.address.line1,
        shipLine2: input.address.line2 ?? null,
        shipLandmark: input.address.landmark ?? null,
        shipInstructions: input.address.instructions ?? null,
        shipAreaNameBn: areaNameBn,
        subtotalPoisha: 0,
        deliveryFeePoisha: 0,
        totalPoisha: 0,
        idempotencyKey,
        policyVersionAccepted: input.acceptedPolicyVersion,
        paymentExpiresAt,
        createdAt: this.clock.now(),
      },
    });
  }

  async ensureCart(customerId: string) {
    const cart = await this.prisma.cart.findUnique({ where: { userId: customerId } });
    if (!cart) throw notFound('Cart');
    return cart;
  }
}

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
/** "DW-261019-7KQ4ZP": date for humans + 6 CSPRNG characters (non-sequential, not guessable). */
export function orderNumber(now: Date): string {
  const d = dhakaDate(now).slice(2).replace(/-/g, '');
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `DW-${d}-${s}`;
}
