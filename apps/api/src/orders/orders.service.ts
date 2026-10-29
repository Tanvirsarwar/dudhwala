import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { randomInt } from 'node:crypto';
import { deliveryFeePoisha, nextOrderStatuses, orderFinalStatus, orderInitialStatus, type FulfilmentMethod, type OrderStatus as FlowStatus, type PaymentStatus } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { newId, sha256Hex } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService, type StockActor } from '../inventory/inventory.service.js';
import { OutletsService } from '../outlets/outlets.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CartService } from '../cart/cart.service.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';
import type { Principal } from '../access/principal.js';
import type { Prisma } from '../generated/prisma/client.js';
import { assertOrderRules, type RuleLine } from './order-rules.js';

export interface PlaceOrderInput {
  method: FulfilmentMethod;
  zone: 'IN_CITY' | 'OUTER_CITY' | null;
  lines: { variantId: string; quantity: number }[];
  contact: { name: string; phone: string; line1?: string | null; landmark?: string | null };
  outletId?: string | null;
  pickupAt?: Date | null;
}

const ORDER_INCLUDE = { items: true, outlet: true, events: { orderBy: { createdAt: 'asc' } } } as const;
type OrderFull = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function orderNumber(now: Date): string {
  const d = new Date(now.getTime() + 6 * 3_600_000);
  const date = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `DW${date}${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(OutletsService) private readonly outlets: OutletsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CartService) private readonly carts: CartService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  // ───────────── placing ─────────────

  /**
   * Places an order. Everything is decided here from the database; the client only says what it wants.
   * One transaction: idempotency claim, rules, price, stock reservation, order rows, audit.
   */
  async place(customerId: string, idempotencyKey: string, input: PlaceOrderInput, req: Request): Promise<{ order: ReturnType<OrdersService['customerView']>; replayed: boolean }> {
    await this.limits.hit(LIMITS.orderPerCustomer, customerId);
    const requestHash = sha256Hex(JSON.stringify({ ...input, pickupAt: input.pickupAt?.toISOString() ?? null }));
    const principalKey = `user:${customerId}`;
    const route = 'POST /orders';

    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$executeRaw`
          INSERT INTO idempotency_record (key, principal, route, request_hash, created_at)
          VALUES (${idempotencyKey}, ${principalKey}, ${route}, ${requestHash}, ${this.clock.now()})
          ON CONFLICT DO NOTHING`;
        if (claimed === 0) {
          const prev = await tx.idempotencyRecord.findUniqueOrThrow({ where: { key_principal_route: { key: idempotencyKey, principal: principalKey, route } } });
          if (prev.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was used with a different request');
          const orderId = (prev.responseBody as { orderId?: string } | null)?.orderId;
          if (!orderId) throw new AppError('CONFLICT', 'The first request with this key is still being processed');
          return { order: this.customerView(await this.load(tx, orderId)), replayed: true };
        }

        const now = this.clock.now();
        const { config } = await this.settings.ordering(tx);
        const ids = input.lines.map((l) => l.variantId);
        if (new Set(ids).size !== ids.length) throw new AppError('VALIDATION_FAILED', 'Each product option may appear once');
        const variants = await tx.productVariant.findMany({ where: { id: { in: ids } }, include: { product: { include: { category: true } } } });
        const byId = new Map(variants.map((v) => [v.id, v]));
        const lines: (RuleLine & { variant: (typeof variants)[number] })[] = input.lines.map((l) => {
          const v = byId.get(l.variantId);
          if (!v || !v.product.active || !v.product.category.active) throw new AppError('PRODUCT_UNAVAILABLE', 'কিছু পণ্য আর পাওয়া যাচ্ছে না', { variantId: l.variantId });
          if (v.pricePoisha === null) throw new AppError('PRICE_NOT_SET', 'কিছু পণ্যের দাম এখনো নির্ধারিত হয়নি', { variantId: l.variantId });
          if (l.quantity > v.maxQty) throw new AppError('VALIDATION_FAILED', `Maximum ${v.maxQty} per order for this item`, { variantId: l.variantId });
          return { variantId: v.id, nameBn: v.product.nameBn, categorySlug: v.product.category.slug, outerCityStatus: v.product.outerCityStatus, quantity: l.quantity, unitPricePoisha: v.pricePoisha, variant: v };
        });

        // Outlet that fulfils the order.
        let outletId: string;
        let pickupOutletOpen: ((at: Date) => boolean) | undefined;
        if (input.method === 'HOME_DELIVERY') {
          const dispatch = await this.settings.get('fulfilment.dispatchOutletId', tx);
          if (!dispatch) throw new AppError('SERVICE_UNAVAILABLE', 'হোম ডেলিভারি এখনো চালু হয়নি');
          outletId = dispatch;
        } else if (input.method === 'BULK_ORDER') {
          const collection = await this.settings.get('bulk.collectionOutletId', tx);
          if (!collection) throw new AppError('BULK_NOT_CONFIGURED', 'বাল্ক অর্ডার এখনো চালু হয়নি');
          outletId = collection;
        } else {
          if (!input.outletId) throw new AppError('VALIDATION_FAILED', 'Choose a pickup outlet');
          outletId = input.outletId;
        }
        const outlet = await tx.outlet.findUnique({ where: { id: outletId }, include: { hours: true } });
        if (!outlet || outlet.status !== 'ACTIVE') throw new AppError(input.method === 'EXPRESS_PICKUP' ? 'VALIDATION_FAILED' : 'SERVICE_UNAVAILABLE', 'এই আউটলেট এখন অর্ডার নিচ্ছে না');
        if (input.method === 'EXPRESS_PICKUP') pickupOutletOpen = (at) => this.outlets.openAt(outlet, at, config.hours);

        const checked = assertOrderRules({
          now,
          method: input.method,
          zone: input.method === 'HOME_DELIVERY' ? input.zone : null,
          lines,
          config,
          contact: input.contact,
          pickup: input.method === 'EXPRESS_PICKUP' ? { at: input.pickupAt ?? null, outletOpen: pickupOutletOpen as (at: Date) => boolean } : undefined,
        });


        const orderId = newId();
        const status = orderInitialStatus(input.method);
        const fee = deliveryFeePoisha(input.method, input.method === 'HOME_DELIVERY' ? input.zone : null, await this.settings.get('delivery.fees', tx));
        const bulkRule = input.method === 'BULK_ORDER' ? await this.settings.get('bulk.rule', tx) : null;
        const order = await tx.order.create({
          data: {
            id: orderId,
            orderNumber: orderNumber(now),
            userId: customerId,
            outletId,
            method: input.method,
            zone: input.method === 'HOME_DELIVERY' ? input.zone : null,
            status,
            paymentMethod: 'COD',
            paymentStatus: 'UNPAID',
            contactName: input.contact.name.trim(),
            contactPhone: checked.phone,
            addressLine1: input.method === 'HOME_DELIVERY' ? (input.contact.line1 ?? '').trim() : null,
            addressLandmark: input.method === 'HOME_DELIVERY' ? input.contact.landmark?.trim() || null : null,
            pickupAt: input.method === 'EXPRESS_PICKUP' ? (input.pickupAt as Date) : null,
            subtotalPoisha: checked.subtotalPoisha,
            deliveryFeePoisha: fee,
            totalPoisha: checked.subtotalPoisha + fee,
            idempotencyKey,
            bulkRuleSnapshot: bulkRule ?? undefined,
            createdAt: now,
          },
        });
        await tx.orderItem.createMany({
          data: lines.map((l) => ({
            id: newId(),
            orderId,
            productVariantId: l.variantId,
            productSlug: l.variant.product.slug,
            productNameBn: l.variant.product.nameBn,
            productNameEn: l.variant.product.nameEn,
            variantLabelBn: l.variant.labelBn,
            unitPricePoisha: l.unitPricePoisha,
            quantity: l.quantity,
            lineTotalPoisha: l.unitPricePoisha * l.quantity,
          })),
        });
        await this.inventory.reserve(
          tx,
          outletId,
          lines.filter((l) => l.variant.trackStock).map((l) => ({ variantId: l.variantId, qty: l.quantity })),
          orderId,
          { userId: customerId },
        );
        await tx.orderStatusEvent.create({ data: { id: newId(), orderId, fromStatus: null, toStatus: status, actorUserId: customerId, actorRole: 'CUSTOMER', createdAt: now } });
        await this.audit.record(
          { action: 'order.place', entityType: 'order', entityId: orderId, after: { method: input.method, totalPoisha: order.totalPoisha, lines: lines.length } },
          { userId: customerId, actorRole: 'CUSTOMER' },
          req,
          tx,
        );
        const cart = await tx.cart.findUnique({ where: { userId: customerId } });
        if (cart) await this.carts.clear(cart.id, tx);
        await tx.idempotencyRecord.update({
          where: { key_principal_route: { key: idempotencyKey, principal: principalKey, route } },
          data: { responseBody: { orderId }, statusCode: 201 },
        });
        return { order: this.customerView(await this.load(tx, orderId)), replayed: false };
      },
      { timeout: 20_000 },
    );
  }

  // ───────────── reading ─────────────

  private async load(tx: Tx, id: string): Promise<OrderFull> {
    return tx.order.findUniqueOrThrow({ where: { id }, include: ORDER_INCLUDE });
  }

  private base(o: OrderFull) {
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      method: o.method,
      zone: o.zone,
      status: o.status,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      paidAt: o.paidAt,
      lines: o.items.map((i) => ({
        variantId: i.productVariantId,
        productSlug: i.productSlug,
        nameBn: i.productNameBn,
        nameEn: i.productNameEn,
        labelBn: i.variantLabelBn,
        quantity: i.quantity,
        unitPricePoisha: i.unitPricePoisha,
        linePoisha: i.lineTotalPoisha,
      })),
      subtotalPoisha: o.subtotalPoisha,
      deliveryFeePoisha: o.deliveryFeePoisha,
      totalPoisha: o.totalPoisha,
      address: o.method === 'HOME_DELIVERY' ? { name: o.contactName, phone: o.contactPhone, line1: o.addressLine1, landmark: o.addressLandmark ?? '' } : null,
      contact: o.method === 'HOME_DELIVERY' ? null : { name: o.contactName, phone: o.contactPhone },
      pickupAt: o.pickupAt,
      outlet: { id: o.outlet.id, nameBn: o.outlet.nameBn, nameEn: o.outlet.nameEn, addressLine: o.outlet.addressLine },
      history: o.events.map((e) => ({ status: e.toStatus, at: e.createdAt })),
    };
  }

  customerView(o: OrderFull) {
    return this.base(o);
  }

  staffView(o: OrderFull) {
    const flow = nextOrderStatuses(o.method, o.status as FlowStatus);
    return { ...this.base(o), cancelReason: o.cancelReason, next: flow, history: o.events.map((e) => ({ status: e.toStatus, at: e.createdAt, by: e.actorRole })) };
  }

  /** Owner-only: a customer asking for someone else's order id gets the same 404 as for an unknown id. */
  async getForCustomer(p: Principal, id: string) {
    const o = await this.prisma.order.findFirst({ where: { id, userId: p.userId }, include: ORDER_INCLUDE });
    if (!o) throw notFound('Order');
    return this.customerView(o);
  }

  async listForCustomer(p: Principal) {
    const rows = await this.prisma.order.findMany({ where: { userId: p.userId }, include: ORDER_INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((o) => this.customerView(o));
  }

  async getForStaff(id: string) {
    const o = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!o) throw notFound('Order');
    return this.staffView(o);
  }

  // ───────────── status changes ─────────────

  /**
   * The single place order status changes. Locks the row, checks the move against the shared flow,
   * and keeps stock consistent: finishing commits the reserved units, cancelling releases them.
   */
  async transition(
    tx: Tx,
    orderId: string,
    to: FlowStatus,
    who: { actor: Principal | { system: string }; reason?: string | null },
    req?: Request,
  ): Promise<OrderFull> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "order" WHERE id = ${orderId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound('Order');
    const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const from = o.status as FlowStatus;
    const allowed = nextOrderStatuses(o.method, from);
    if (!allowed.includes(to)) throw new AppError('INVALID_TRANSITION', 'এই অবস্থায় এই পরিবর্তন করা যাবে না', { from, to, allowed });

    const stockActor: StockActor = 'system' in who.actor ? { system: who.actor.system } : who.actor.kind === 'STAFF' ? { userId: who.actor.userId } : { userId: who.actor.userId };
    const now = this.clock.now();
    const data: Prisma.OrderUpdateInput = { status: to };
    if (to === 'CANCELLED') {
      data.cancelReason = who.reason ?? null;
      await this.inventory.release(tx, orderId, stockActor, who.reason ?? 'cancelled');
    }
    if (to === orderFinalStatus(o.method)) await this.inventory.commit(tx, orderId, stockActor);
    const changed = await tx.order.updateMany({ where: { id: orderId, status: from }, data: { ...data, updatedAt: now } as Prisma.OrderUpdateManyMutationInput });
    if (changed.count === 0) throw new AppError('CONFLICT', 'The order changed; reload and try again');
    await tx.orderStatusEvent.create({
      data: {
        id: newId(),
        orderId,
        fromStatus: from,
        toStatus: to,
        actorUserId: 'system' in who.actor ? null : who.actor.userId,
        actorRole: 'system' in who.actor ? who.actor.system.toUpperCase() : who.actor.kind === 'STAFF' ? who.actor.role : 'CUSTOMER',
        reason: who.reason ?? null,
        createdAt: now,
      },
    });
    await this.audit.record(
      { action: 'order.status', entityType: 'order', entityId: orderId, before: { status: from }, after: { status: to, ...(o.paymentStatus === 'PAID' && to === 'CANCELLED' ? { refundRequired: true } : {}) } },
      'system' in who.actor ? { actorRole: who.actor.system.toUpperCase() } : { principal: who.actor },
      req,
      tx,
    );
    return this.load(tx, orderId);
  }

  /** Staff record that the cash was (or was not) collected. Independent of the delivery status; not allowed on cancelled orders. */
  async setPaymentStatus(orderId: string, to: PaymentStatus, p: Extract<Principal, { kind: 'STAFF' }>, req: Request): Promise<OrderFull> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "order" WHERE id = ${orderId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw notFound('Order');
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (o.status === 'CANCELLED') throw new AppError('INVALID_TRANSITION', 'Cancelled orders cannot be marked paid');
      if (o.paymentStatus !== to) {
        const now = this.clock.now();
        await tx.order.update({ where: { id: orderId }, data: to === 'PAID' ? { paymentStatus: 'PAID', paidAt: now, paidById: p.userId } : { paymentStatus: 'UNPAID', paidAt: null, paidById: null } });
        await this.audit.record({ action: 'order.payment', entityType: 'order', entityId: orderId, before: { paymentStatus: o.paymentStatus }, after: { paymentStatus: to } }, { principal: p }, req, tx);
      }
      return this.load(tx, orderId);
    });
  }
}
