import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { assertOrderTransition, holdsReservation, InvalidTransitionError, type OrderActor, type OrderStatus } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { newId, sha256Hex } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: OrderActor;
  actorUserId: string | null;
  actorRole: string;
  reason?: string | null;
  /** When closing a failed delivery: what happens to the returned goods (OPEN_DECISIONS C6). */
  returnedGoods?: 'RESTOCK' | 'WRITE_OFF';
  /** Restrict to these outlets (staff scope). Omit for system/customer callers. */
  outletScope?: 'ALL' | readonly string[];
  /** Restrict to this customer. */
  customerId?: string;
}

const TERMINAL_RELEASE: ReadonlySet<OrderStatus> = new Set(['CANCELLED', 'REJECTED', 'EXPIRED']);
const BEFORE_DISPATCH: ReadonlySet<OrderStatus> = new Set(['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH']);

/**
 * The single place order status changes happen. Every transition is checked
 * against the shared state machine and applies its stock, slot, coupon,
 * delivery, refund and notification side-effects in the same transaction,
 * guarded by `WHERE status = from` so concurrent changes cannot double-apply.
 */
@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  async transition(input: TransitionInput, req?: Request): Promise<{ status: OrderStatus }> {
    return this.prisma.$transaction((tx) => this.transitionInTx(tx, input, req), { timeout: 20_000 });
  }

  async transitionInTx(tx: Tx, input: TransitionInput, req?: Request): Promise<{ status: OrderStatus }> {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true, payments: true, delivery: { include: { cod: true } } } });
    if (!order) throw notFound('Order');
    if (input.customerId && order.userId !== input.customerId) throw notFound('Order');
    if (input.outletScope && input.outletScope !== 'ALL' && !input.outletScope.includes(order.outletId)) throw notFound('Order');

    const from = order.status as OrderStatus;
    assertOrderTransition(from, input.to, input.actor);
    if (input.to === 'CANCELLED' || input.to === 'REJECTED') {
      if (!input.reason?.trim()) throw new AppError('VALIDATION_FAILED', 'A reason is required');
    }
    if (from === 'DELIVERY_FAILED' && input.to === 'CANCELLED' && !input.returnedGoods) {
      throw new AppError('VALIDATION_FAILED', 'Choose whether returned goods are restocked or written off');
    }
    if (input.to === 'OUT_FOR_DELIVERY' && !order.delivery?.riderUserId) throw new AppError('CONFLICT', 'Assign a rider before dispatch');

    const now = this.clock.now();
    const claimed = await tx.order.updateMany({
      where: { id: order.id, status: from },
      data: {
        status: input.to,
        ...(input.to === 'CONFIRMED' ? { confirmedAt: now } : {}),
        ...(input.to === 'PLACED' ? { placedAt: now } : {}),
        ...(input.to === 'DELIVERED' ? { deliveredAt: now } : {}),
        ...(TERMINAL_RELEASE.has(input.to) ? { cancelledAt: now, cancelReason: input.reason ?? input.to } : {}),
      },
    });
    if (claimed.count === 0) throw new InvalidTransitionError(from, input.to, input.actor);

    const lines = order.items.filter((i) => i.productVariantId).map((i) => ({ variantId: i.productVariantId as string, qty: i.quantity }));
    const actor = input.actorUserId ? { userId: input.actorUserId } : { system: `orders:${input.actorRole}` };
    // Sequential and in variant-id order, so concurrent orders lock rows in the same order (no deadlocks).
    const mv = async (type: 'RELEASE' | 'COMMIT_SALE' | 'RESTOCK_RETURN' | 'RESERVE' | 'WRITE_OFF', reason?: string, ignoreBuffer?: boolean) => {
      for (const l of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
        await this.inventory.apply(tx, { outletId: order.outletId, variantId: l.variantId, type, qty: l.qty, orderId: order.id, reason: reason ?? null, ignoreBuffer }, actor);
      }
    };

    // ── Stock & slot side-effects ──
    if (TERMINAL_RELEASE.has(input.to) && holdsReservation(from)) {
      await mv('RELEASE');
      if (from === 'DELIVERY_FAILED' && input.returnedGoods === 'WRITE_OFF') await mv('WRITE_OFF', `Failed delivery written off: ${input.reason ?? ''}`.trim());
      if (BEFORE_DISPATCH.has(from)) {
        await tx.$executeRaw`UPDATE delivery_slot SET booked_count = booked_count - 1 WHERE id = ${order.deliverySlotId}::uuid AND booked_count > 0`;
      }
      if (order.couponId) {
        const red = await tx.couponRedemption.updateMany({ where: { orderId: order.id, status: { in: ['RESERVED', 'CONFIRMED'] } }, data: { status: 'RELEASED' } });
        if (red.count > 0) await tx.$executeRaw`UPDATE coupon SET used_count = used_count - 1 WHERE id = ${order.couponId}::uuid AND used_count > 0`;
      }
      if (order.delivery) {
        await tx.delivery.update({ where: { id: order.delivery.id }, data: { status: from === 'DELIVERY_FAILED' ? 'RETURNED' : 'UNASSIGNED', closedAt: now } });
        if (order.delivery.cod && order.delivery.cod.status === 'PENDING') await tx.codCollection.update({ where: { id: order.delivery.cod.id }, data: { status: 'NOT_COLLECTED' } });
      }
      // Online payment already captured → refund task for Super Admin (E3).
      for (const pay of order.payments.filter((x) => x.method === 'ONLINE' && (x.status === 'PAID' || x.status === 'PARTIALLY_REFUNDED'))) {
        const remaining = (pay.paidAmountPoisha ?? 0) - pay.refundedPoisha;
        if (remaining > 0 && !(await tx.refund.findFirst({ where: { paymentId: pay.id, status: { in: ['REQUESTED', 'SUBMITTED'] } } }))) {
          await tx.refund.create({
            data: { id: newId(), paymentId: pay.id, amountPoisha: remaining, reason: `Order ${input.to.toLowerCase()}: ${input.reason ?? ''}`.trim(), idempotencyKey: `auto-${sha256Hex(`${order.id}:${pay.id}`).slice(0, 48)}`, requestedById: input.actorUserId ?? order.userId },
          });
        }
      }
      // Unpaid online attempts are cancelled.
      await tx.payment.updateMany({ where: { orderId: order.id, method: 'ONLINE', status: { in: ['UNPAID', 'PENDING'] } }, data: { status: 'CANCELLED' } });
      if (order.paymentMethod === 'COD' || !order.payments.some((x) => x.status === 'PAID')) {
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'CANCELLED' } });
      }
    }

    if (input.to === 'OUT_FOR_DELIVERY') {
      await mv('COMMIT_SALE');
      await tx.delivery.update({ where: { orderId: order.id }, data: { status: 'PICKED_UP' } });
    }
    if (from === 'OUT_FOR_DELIVERY' && input.to === 'DELIVERY_FAILED') {
      // Goods come back to the outlet and stay held for this order until rescheduled or closed.
      await mv('RESTOCK_RETURN', 'Returned after failed delivery');
      await mv('RESERVE', undefined, true);
    }
    if (input.to === 'DELIVERED' && order.delivery) {
      await tx.delivery.update({ where: { id: order.delivery.id }, data: { status: 'DELIVERED', closedAt: now } });
      if (order.couponId) await tx.couponRedemption.updateMany({ where: { orderId: order.id, status: 'RESERVED' }, data: { status: 'CONFIRMED' } });
    }

    await tx.orderStatusEvent.create({
      data: { id: newId(), orderId: order.id, fromStatus: from, toStatus: input.to, actorUserId: input.actorUserId, actorRole: input.actorRole, reason: input.reason ?? null, createdAt: now },
    });
    await this.audit.record(
      { action: `order.${input.to.toLowerCase()}`, entityType: 'order', entityId: order.id, outletId: order.outletId, before: { status: from }, after: { status: input.to, reason: input.reason ?? null } },
      { userId: input.actorUserId, actorRole: input.actorRole },
      req,
      tx,
    );
    await this.notifications.orderEvent(tx, order.id, input.to);
    return { status: input.to };
  }
}
