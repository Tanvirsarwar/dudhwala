import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Request } from 'express';
import { applyRefund, canTransitionPayment, checkVerifiedPayment, type PaymentStatus } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { newId } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PaymentGateway } from './gateway.js';
import { FAKE_IPN_JOB, FAKE_SIGNATURE_HEADER, FakeGateway } from './fake-gateway.js';

export const PAYMENT_EXPIRY_JOB = 'payments.expire_and_reconcile';
const RECONCILE_AFTER_MS = 10 * 60_000;

/**
 * Online payment lifecycle (TRD §5.6, API_SPECIFICATION §5).
 * Rule: a payment becomes PAID only inside verifyAndApply(), after the
 * gateway's server-to-server status query matches merchant reference,
 * amount and currency. Browser redirects and callbacks only trigger checks.
 */
@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger('Payments');
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get providerCode(): string {
    return this.gateway.code;
  }

  onModuleInit(): void {
    this.jobs.register(PAYMENT_EXPIRY_JOB, async () => {
      await this.expireAndReconcile();
      if ((await this.prisma.job.count({ where: { type: PAYMENT_EXPIRY_JOB, status: 'PENDING' } })) === 0) {
        await this.jobs.enqueue(PAYMENT_EXPIRY_JOB, {}, { runAt: new Date(this.clock.now().getTime() + 60_000) });
      }
    });
    // Simulator only: deliver its IPN like a gateway would (asynchronously, retried).
    if (this.gateway instanceof FakeGateway) {
      const fake = this.gateway;
      this.jobs.register(FAKE_IPN_JOB, async (payload) => {
        const body = JSON.stringify(payload);
        const fakeReq = { body: JSON.parse(body) as unknown, header: (h: string) => (h === FAKE_SIGNATURE_HEADER ? fake.sign(body) : undefined) } as unknown as Request;
        await this.handleCallback(fakeReq, 'IPN');
      });
    }
  }

  async scheduleJobs(): Promise<void> {
    if ((await this.prisma.job.count({ where: { type: PAYMENT_EXPIRY_JOB, status: 'PENDING' } })) === 0) await this.jobs.enqueue(PAYMENT_EXPIRY_JOB, {});
  }

  /** Starts (or restarts) an online payment for the customer's order. */
  async initiate(orderId: string, customerId: string, req?: Request): Promise<{ redirectUrl: string }> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId: customerId }, include: { payments: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw notFound('Order');
    if (order.status !== 'PENDING_PAYMENT' || order.paymentMethod !== 'ONLINE') throw new AppError('CONFLICT', 'এই অর্ডারের জন্য পেমেন্ট প্রয়োজন নেই');
    if (!order.paymentExpiresAt || order.paymentExpiresAt <= this.clock.now()) throw new AppError('CONFLICT', 'পেমেন্টের সময় শেষ হয়ে গেছে');
    if (order.payments.some((p) => p.status === 'PAID')) throw new AppError('CONFLICT', 'পেমেন্ট ইতিমধ্যে সম্পন্ন');
    // A payment already pending at the gateway must be resolved first (no double charge).
    for (const p of order.payments.filter((x) => x.status === 'PENDING')) {
      await this.verifyAndApply(p.merchantTranId);
    }
    const fresh = await this.prisma.payment.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    if (fresh.some((p) => p.status === 'PAID')) throw new AppError('CONFLICT', 'পেমেন্ট ইতিমধ্যে সম্পন্ন');
    let payment = fresh.find((p) => p.status === 'UNPAID' && p.method === 'ONLINE');
    if (!payment) {
      payment = await this.prisma.payment.create({
        data: { id: newId(), orderId, method: 'ONLINE', provider: this.gateway.code, status: 'UNPAID', amountPoisha: order.totalPoisha, merchantTranId: `${order.orderNumber}-${fresh.length + 1}` },
      });
    }
    let session: { redirectUrl: string; providerSessionId: string };
    try {
      session = await this.gateway.initiate({
        merchantTranId: payment.merchantTranId,
        amountPoisha: payment.amountPoisha, // from the database, never from the client
        orderNumber: order.orderNumber,
        customerPhone: order.shipPhone,
        returnUrl: `${this.env.WEB_ORIGIN}/checkout/return?order=${order.id}`,
        ipnUrl: `${this.env.API_PUBLIC_URL}/v1/webhooks/payments/${this.gateway.code}`,
      });
    } catch (e) {
      this.logger.error(`gateway initiate failed: ${String(e)}`);
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', 'পেমেন্ট সেবা এখন পাওয়া যাচ্ছে না, একটু পরে চেষ্টা করুন');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { id: payment.id, status: 'UNPAID' }, data: { status: 'PENDING', providerSessionId: session.providerSessionId } });
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: 'PENDING' } });
      await tx.paymentEvent.create({ data: { id: newId(), paymentId: payment.id, provider: this.gateway.code, providerEventId: `init-${payment.id}-${session.providerSessionId}`, kind: 'INIT', payload: { sessionId: session.providerSessionId } } });
      await this.audit.record({ action: 'payment.initiate', entityType: 'payment', entityId: payment.id, outletId: order.outletId }, { userId: customerId, actorRole: 'CUSTOMER' }, req, tx);
    });
    return { redirectUrl: session.redirectUrl };
  }

  /** Webhook/IPN entry point. Stores the raw event first; duplicates are no-ops. */
  async handleCallback(req: Request, kind: 'IPN' | 'CALLBACK' = 'IPN'): Promise<{ accepted: boolean; result: string }> {
    const claim = await this.gateway.parseCallback(req);
    const eventId = newId();
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO payment_event (id, provider, provider_event_id, kind, signature_valid, payload, received_at)
      VALUES (${eventId}::uuid, ${this.gateway.code}, ${claim.providerEventId}, ${kind}::"PaymentEventKind", ${claim.signatureValid}, ${JSON.stringify(redact(claim.payload))}::jsonb, ${this.clock.now()})
      ON CONFLICT (provider, provider_event_id) DO NOTHING`;
    if (inserted === 0) return { accepted: true, result: 'DUPLICATE' };
    let result: string;
    if (!claim.signatureValid) {
      result = 'REJECTED_SIGNATURE';
      this.logger.warn(`payment callback with invalid signature (event ${claim.providerEventId})`);
    } else {
      result = await this.verifyAndApply(claim.merchantTranId);
    }
    const payment = await this.prisma.payment.findUnique({ where: { merchantTranId: claim.merchantTranId } });
    await this.prisma.paymentEvent.update({ where: { id: eventId }, data: { processedAt: this.clock.now(), processingResult: result, paymentId: payment?.id ?? null } });
    return { accepted: true, result };
  }

  /** Queries the gateway and applies the verified state. Safe to call any number of times. */
  async verifyAndApply(merchantTranId: string): Promise<string> {
    const payment = await this.prisma.payment.findUnique({ where: { merchantTranId } });
    if (!payment || payment.method !== 'ONLINE') return 'UNKNOWN_PAYMENT';
    const vt = await this.gateway.verify(merchantTranId);
    await this.prisma.paymentEvent.create({
      data: { id: newId(), paymentId: payment.id, provider: this.gateway.code, providerEventId: `verify-${newId()}`, kind: 'VERIFY_RESPONSE', payload: (vt ?? { notFound: true }) as unknown as Prisma.InputJsonValue },
    });
    if (!vt) return 'NOT_FOUND_AT_GATEWAY';
    if (vt.status === 'PENDING') return 'STILL_PENDING';
    if (vt.status === 'FAILED' || vt.status === 'CANCELLED') {
      const to: PaymentStatus = vt.status;
      if (!canTransitionPayment(payment.status as PaymentStatus, to, 'GATEWAY_VERIFIED')) return `NOOP_${payment.status}`;
      await this.prisma.$transaction(async (tx) => {
        const n = await tx.payment.updateMany({ where: { id: payment.id, status: payment.status }, data: { status: to, failureCode: vt.status } });
        if (n.count) await tx.order.updateMany({ where: { id: payment.orderId, paymentStatus: { not: 'PAID' } }, data: { paymentStatus: 'FAILED' } });
      });
      return to;
    }
    const check = checkVerifiedPayment({ merchantTranId: payment.merchantTranId, amountPoisha: payment.amountPoisha }, vt);
    if (!check.ok) {
      this.logger.error(`payment verification mismatch ${check.reason} for ${merchantTranId}`);
      return `MISMATCH_${check.reason}`;
    }
    if (!canTransitionPayment(payment.status as PaymentStatus, 'PAID', 'GATEWAY_VERIFIED')) return `NOOP_${payment.status}`;

    return this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.payment.updateMany({
          where: { id: payment.id, status: payment.status },
          data: { status: 'PAID', verifiedAt: this.clock.now(), paidAmountPoisha: vt.amountPoisha, providerTranId: vt.providerTranId },
        });
        if (claimed.count === 0) return 'NOOP_CONCURRENT';
        const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId }, include: { payments: true, items: true } });
        const otherPaid = order.payments.some((p) => p.id !== payment.id && p.status === 'PAID');
        if (otherPaid) {
          await tx.payment.update({ where: { id: payment.id }, data: { duplicateCapture: true } });
          await this.requestRefund(tx, payment.id, vt.amountPoisha, 'Duplicate capture', order.userId);
          return 'DUPLICATE_CAPTURE_REFUND_REQUESTED';
        }
        await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
        if (order.status === 'PENDING_PAYMENT') {
          await this.orders.transitionInTx(tx, { orderId: order.id, to: 'PLACED', actor: 'SYSTEM', actorUserId: null, actorRole: 'SYSTEM', reason: 'payment verified' });
          await this.autoConfirm(tx, order.id, order.outletId);
          return 'PAID';
        }
        if (order.status === 'EXPIRED') return this.recoverExpired(tx, order, payment.id, vt.amountPoisha);
        // Paid after the order was cancelled/rejected: money must go back.
        await this.requestRefund(tx, payment.id, vt.amountPoisha, `Paid after order ${order.status.toLowerCase()}`, order.userId);
        return 'PAID_AFTER_CLOSE_REFUND_REQUESTED';
      },
      { timeout: 20_000 },
    );
  }

  private async autoConfirm(tx: Tx, orderId: string, outletId: string) {
    const outlet = await tx.outlet.findUniqueOrThrow({ where: { id: outletId } });
    if (outlet.autoConfirmOrders) await this.orders.transitionInTx(tx, { orderId, to: 'CONFIRMED', actor: 'SYSTEM', actorUserId: null, actorRole: 'SYSTEM', reason: 'auto-confirm' });
  }

  /** Paid after the hold expired (APP_FLOW §1.3): re-reserve if possible, else refund. */
  private async recoverExpired(tx: Tx, order: { id: string; outletId: string; deliverySlotId: string; userId: string; items: { productVariantId: string | null; quantity: number }[] }, paymentId: string, amount: number): Promise<string> {
    await tx.$executeRaw`SAVEPOINT recover`;
    try {
      const slot = await tx.$queryRaw<{ id: string }[]>`
        UPDATE delivery_slot SET booked_count = booked_count + 1
        WHERE id = ${order.deliverySlotId}::uuid AND status = 'OPEN' AND cutoff_at > ${this.clock.now()} AND booked_count < capacity RETURNING id`;
      if (slot.length === 0) throw new AppError('SLOT_FULL', 'slot');
      await this.inventory.reserveLines(tx, order.outletId, order.items.filter((i) => i.productVariantId).map((i) => ({ variantId: i.productVariantId as string, qty: i.quantity })), order.id);
      await tx.$executeRaw`RELEASE SAVEPOINT recover`;
    } catch {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT recover`;
      await this.requestRefund(tx, paymentId, amount, 'Paid after payment window expired; stock or slot no longer available', order.userId);
      return 'PAID_AFTER_EXPIRY_REFUND_REQUESTED';
    }
    await tx.order.update({ where: { id: order.id }, data: { cancelledAt: null, cancelReason: null } });
    await this.orders.transitionInTx(tx, { orderId: order.id, to: 'PLACED', actor: 'SYSTEM', actorUserId: null, actorRole: 'SYSTEM', reason: 'payment verified after expiry; re-reserved' });
    await this.autoConfirm(tx, order.id, order.outletId);
    return 'PAID_AFTER_EXPIRY_RECOVERED';
  }

  private async requestRefund(tx: Tx, paymentId: string, amount: number, reason: string, requestedById: string) {
    if (await tx.refund.findFirst({ where: { paymentId, status: { in: ['REQUESTED', 'SUBMITTED'] } } })) return;
    await tx.refund.create({ data: { id: newId(), paymentId, amountPoisha: amount, reason, idempotencyKey: `auto-${newId()}`, requestedById } });
  }

  /** Every minute: re-verify stale pending payments, then expire unpaid holds (stock/slot released). */
  async expireAndReconcile(): Promise<{ reconciled: number; expired: number }> {
    const now = this.clock.now();
    const stale = await this.prisma.payment.findMany({ where: { method: 'ONLINE', status: 'PENDING', updatedAt: { lt: new Date(now.getTime() - RECONCILE_AFTER_MS) } }, take: 50 });
    for (const p of stale) await this.verifyAndApply(p.merchantTranId).catch((e: unknown) => this.logger.warn(String(e)));
    const due = await this.prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: now } }, include: { payments: true }, take: 50 });
    let expired = 0;
    for (const o of due) {
      // Last check with the gateway before giving the stock and slot away.
      for (const p of o.payments.filter((x) => x.status === 'PENDING')) await this.verifyAndApply(p.merchantTranId).catch(() => undefined);
      const still = await this.prisma.order.findUnique({ where: { id: o.id } });
      if (still?.status !== 'PENDING_PAYMENT') continue;
      try {
        await this.orders.transition({ orderId: o.id, to: 'EXPIRED', actor: 'SYSTEM', actorUserId: null, actorRole: 'SYSTEM', reason: 'payment not completed in time' });
        expired++;
      } catch (e) {
        this.logger.warn(`expire ${o.id}: ${String(e)}`);
      }
    }
    await this.checkSubmittedRefunds().catch((e: unknown) => this.logger.warn(`refund status check: ${String(e)}`));
    return { reconciled: stale.length, expired };
  }

  /** Gateways like SSLCOMMERZ accept refunds asynchronously; poll SUBMITTED refunds until final. */
  async checkSubmittedRefunds(): Promise<number> {
    const pending = await this.prisma.refund.findMany({ where: { status: 'SUBMITTED', providerRefundId: { not: null } }, include: { payment: true }, take: 20 });
    let settled = 0;
    for (const r of pending) {
      const s = await this.gateway.refundStatus(r.providerRefundId as string);
      if (s === 'SUBMITTED') continue;
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.refund.updateMany({ where: { id: r.id, status: 'SUBMITTED' }, data: { status: s } });
        if (claimed.count === 0 || s !== 'SUCCEEDED') return;
        const p = await tx.payment.findUniqueOrThrow({ where: { id: r.paymentId } });
        const next = applyRefund(p.paidAmountPoisha ?? 0, p.refundedPoisha, r.amountPoisha);
        await tx.payment.update({ where: { id: p.id }, data: { refundedPoisha: next.refunded, status: next.status } });
        if (!p.duplicateCapture) await tx.order.update({ where: { id: p.orderId }, data: { paymentStatus: next.status } });
        await this.notifications.orderEvent(tx, p.orderId, 'REFUNDED');
      });
      settled++;
    }
    return settled;
  }

  /** Customer gives up online payment and switches to COD, if eligible. */
  async switchToCod(orderId: string, customerId: string, codEligible: (order: { outletId: string; areaId: string; totalPoisha: number }) => Promise<boolean>, req?: Request) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId: customerId }, include: { payments: true, delivery: true } });
    if (!order) throw notFound('Order');
    if (order.status !== 'PENDING_PAYMENT') throw new AppError('CONFLICT', 'এই অর্ডারটি পরিবর্তন করা যাবে না');
    for (const p of order.payments.filter((x) => x.status === 'PENDING')) await this.verifyAndApply(p.merchantTranId);
    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
    if (fresh.status !== 'PENDING_PAYMENT' || fresh.payments.some((p) => p.status === 'PAID' || p.status === 'PENDING')) throw new AppError('CONFLICT', 'পেমেন্টের অবস্থা পরিবর্তিত হয়েছে, পেজটি রিফ্রেশ করুন');
    if (!(await codEligible(fresh))) throw new AppError('COD_NOT_ELIGIBLE', 'এই অর্ডারে ক্যাশ অন ডেলিভারি পাওয়া যাবে না');
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ where: { orderId, method: 'ONLINE', status: { in: ['UNPAID', 'FAILED'] } }, data: { status: 'CANCELLED' } });
      await tx.payment.create({ data: { id: newId(), orderId, method: 'COD', status: 'UNPAID', amountPoisha: fresh.totalPoisha, merchantTranId: `${fresh.orderNumber}-COD` } });
      await tx.order.update({ where: { id: orderId }, data: { paymentMethod: 'COD', paymentStatus: 'UNPAID', paymentExpiresAt: null } });
      const delivery = await tx.delivery.findUniqueOrThrow({ where: { orderId } });
      await tx.codCollection.create({ data: { id: newId(), deliveryId: delivery.id, outletId: fresh.outletId, expectedPoisha: fresh.totalPoisha } });
      await this.orders.transitionInTx(tx, { orderId, to: 'PLACED', actor: 'SYSTEM', actorUserId: customerId, actorRole: 'CUSTOMER', reason: 'switched to cash on delivery' }, req);
      await this.autoConfirm(tx, orderId, fresh.outletId);
    });
  }

  /** Super Admin executes a requested refund through the gateway. */
  async executeRefund(refundId: string, approverId: string, req?: Request): Promise<{ status: string }> {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
    if (!refund) throw notFound('Refund');
    if (refund.status !== 'REQUESTED') throw new AppError('CONFLICT', `Refund is already ${refund.status}`);
    const p = refund.payment;
    if (p.method !== 'ONLINE' || !p.providerTranId || p.paidAmountPoisha == null) throw new AppError('CONFLICT', 'Only verified online payments can be refunded');
    const next = applyRefund(p.paidAmountPoisha, p.refundedPoisha, refund.amountPoisha);
    const claimed = await this.prisma.refund.updateMany({ where: { id: refundId, status: 'REQUESTED' }, data: { status: 'SUBMITTED', approvedById: approverId } });
    if (claimed.count === 0) throw new AppError('CONFLICT', 'Refund changed concurrently');
    const r = await this.gateway.refund({ merchantTranId: p.merchantTranId, providerTranId: p.providerTranId, amountPoisha: refund.amountPoisha, reason: refund.reason });
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentEvent.create({ data: { id: newId(), paymentId: p.id, provider: this.gateway.code, providerEventId: `refund-${refund.id}`, kind: 'REFUND', payload: { ...r } } });
      if (r.status === 'FAILED') {
        await tx.refund.update({ where: { id: refundId }, data: { status: 'FAILED', providerRefundId: r.providerRefundId } });
        return;
      }
      await tx.refund.update({ where: { id: refundId }, data: { status: r.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'SUBMITTED', providerRefundId: r.providerRefundId } });
      if (r.status === 'SUCCEEDED') {
        await tx.payment.update({ where: { id: p.id }, data: { refundedPoisha: next.refunded, status: next.status } });
        if (!p.duplicateCapture) await tx.order.update({ where: { id: p.orderId }, data: { paymentStatus: next.status } });
        await this.notifications.orderEvent(tx, p.orderId, 'REFUNDED');
      }
      await this.audit.record({ action: 'payment.refund', entityType: 'refund', entityId: refundId, after: { amountPoisha: refund.amountPoisha, result: r.status } }, { userId: approverId, actorRole: 'SUPER_ADMIN' }, req, tx);
    });
    return { status: r.status };
  }
}

/** Never store anything card-like or secret from gateway payloads (SECURITY_REVIEW §4). */
function redact(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (/card|pan|cvv|cvc|password|secret|token|signature/i.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 500) : v;
  }
  return out;
}
