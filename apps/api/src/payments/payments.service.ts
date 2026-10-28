import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { Clock } from '../common/clock.js';
import { newId } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentProvider, SandboxProvider, type PaymentEventData } from './provider.js';
import type { Principal } from '../access/principal.js';

export type WebhookResult = 'processed' | 'duplicate' | 'ignored';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(PaymentProvider) private readonly provider: PaymentProvider,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /** Customer starts (or resumes) payment for their own bulk order. */
  async start(p: Principal, orderId: string, req: Request) {
    if (!this.provider.enabled) throw new AppError('PAYMENTS_DISABLED', 'অনলাইন পেমেন্ট এখনো চালু হয়নি');
    await this.limits.hit(LIMITS.paymentPerOrder, orderId);
    const order = await this.prisma.order.findFirst({ where: { id: orderId, userId: p.userId } });
    if (!order) throw notFound('Order');
    if (order.method !== 'BULK_ORDER' || order.status !== 'PENDING_PAYMENT') throw new AppError('CONFLICT', 'This order does not need a payment');
    if (order.paymentExpiresAt && order.paymentExpiresAt <= this.clock.now()) throw new AppError('CONFLICT', 'The payment window for this order has expired');

    let payment = await this.prisma.payment.findFirst({ where: { orderId, status: 'INITIATED' }, orderBy: { createdAt: 'desc' } });
    if (!payment) {
      const attempt = (await this.prisma.payment.count({ where: { orderId } })) + 1;
      payment = await this.prisma.payment.create({
        data: { id: newId(), orderId, provider: this.provider.name, amountPoisha: order.totalPoisha, merchantTranId: `${order.orderNumber}-${attempt}` },
      });
      await this.audit.record({ action: 'payment.start', entityType: 'payment', entityId: payment.id, after: { orderId, provider: this.provider.name } }, { principal: p }, req);
    }
    const session = await this.provider.createSession({ merchantTranId: payment.merchantTranId, amountPoisha: payment.amountPoisha, orderNumber: order.orderNumber });
    return { paymentId: payment.id, merchantTranId: payment.merchantTranId, provider: this.provider.name, sandbox: this.provider.sandbox, redirectUrl: session.redirectUrl };
  }

  /**
   * SANDBOX ONLY: stands in for the gateway. Builds a correctly signed event and feeds it through the same
   * webhook path real providers use, so tests and demos exercise verification, dedupe and amount checks.
   */
  async sandboxComplete(p: Principal, merchantTranId: string, outcome: 'success' | 'fail', req: Request): Promise<WebhookResult> {
    if (!(this.provider instanceof SandboxProvider)) throw notFound('Payment');
    const payment = await this.prisma.payment.findFirst({ where: { merchantTranId, order: { userId: p.userId } } });
    if (!payment) throw notFound('Payment');
    const { body, signature } = this.provider.signedEvent({
      eventId: `sbx-${payment.id}-${outcome}`,
      merchantTranId,
      providerTranId: `SBX-${payment.id.slice(-12)}`,
      status: outcome === 'success' ? 'PAID' : 'FAILED',
      amountPoisha: payment.amountPoisha,
      currency: 'BDT',
    });
    return this.handleWebhook(body, signature, req);
  }

  /**
   * Provider webhook. Order of checks matters: signature first (nothing else is trusted before it), then
   * dedupe by provider event id, then the amount must equal what we asked for. Browser redirects never mark an
   * order paid; only this path does.
   */
  async handleWebhook(rawBody: Buffer, signature: string | undefined, req: Request): Promise<WebhookResult> {
    await this.limits.hit(LIMITS.webhookPerIp, req.ip);
    const event = this.provider.verifyWebhook(rawBody, signature);
    if (!event) {
      await this.audit.record({ action: 'payment.webhook_rejected', entityType: 'payment', after: { reason: 'bad_signature_or_body', bytes: rawBody.length } }, { actorRole: 'WEBHOOK' }, req);
      throw new AppError('UNAUTHENTICATED', 'Invalid webhook');
    }
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { merchantTranId: event.merchantTranId } });
      const fresh = await tx.$executeRaw`
        INSERT INTO payment_event (id, payment_id, provider, provider_event_id, signature_valid, payload, received_at)
        VALUES (${newId()}::uuid, ${payment?.id ?? null}::uuid, ${this.provider.name}, ${event.eventId}, true, ${JSON.stringify(event)}::jsonb, ${this.clock.now()})
        ON CONFLICT (provider, provider_event_id) DO NOTHING`;
      if (fresh === 0) return 'duplicate' as const;
      const done = async (result: string, status: WebhookResult = 'processed') => {
        await tx.paymentEvent.update({ where: { provider_providerEventId: { provider: this.provider.name, providerEventId: event.eventId } }, data: { processingResult: result } });
        return status;
      };
      if (!payment) return done('unknown_payment', 'ignored');
      return this.apply(tx, payment, event, done, req);
    });
  }

  private async apply(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    payment: { id: string; orderId: string; status: string; amountPoisha: number },
    event: PaymentEventData,
    done: (result: string, status?: WebhookResult) => Promise<WebhookResult>,
    req: Request,
  ): Promise<WebhookResult> {
    const now = this.clock.now();
    if (event.currency !== 'BDT' || event.amountPoisha !== payment.amountPoisha) {
      await tx.payment.updateMany({ where: { id: payment.id, status: 'INITIATED' }, data: { status: 'FAILED', failureCode: 'amount_mismatch' } });
      await this.audit.record({ action: 'payment.amount_mismatch', entityType: 'payment', entityId: payment.id, after: { expected: payment.amountPoisha, got: event.amountPoisha } }, { actorRole: 'WEBHOOK' }, req, tx);
      return done('amount_mismatch');
    }
    if (event.status !== 'PAID') {
      await tx.payment.updateMany({ where: { id: payment.id, status: 'INITIATED' }, data: { status: event.status, providerTranId: event.providerTranId } });
      return done(`status_${event.status.toLowerCase()}`);
    }
    // Conditional update: only the first verified success counts.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: 'INITIATED' },
      data: { status: 'PAID', providerTranId: event.providerTranId, verifiedAt: now, paidAmountPoisha: event.amountPoisha },
    });
    if (claimed.count === 0) {
      await this.audit.record({ action: 'payment.duplicate_capture', entityType: 'payment', entityId: payment.id, after: { providerTranId: event.providerTranId } }, { actorRole: 'WEBHOOK' }, req, tx);
      return done('already_settled');
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    if (order.status === 'PENDING_PAYMENT') {
      await this.orders.transition(tx, order.id, 'PREPAID', { actor: { system: 'payment' }, reason: 'Payment verified' }, req, { allowPayment: true });
      return done('order_prepaid');
    }
    // Paid after the order was cancelled or expired: money received for an order that will not be fulfilled.
    await this.audit.record({ action: 'payment.refund_required', entityType: 'payment', entityId: payment.id, after: { orderId: order.id, orderStatus: order.status, amountPoisha: event.amountPoisha } }, { actorRole: 'WEBHOOK' }, req, tx);
    return done('paid_but_order_closed');
  }
}
