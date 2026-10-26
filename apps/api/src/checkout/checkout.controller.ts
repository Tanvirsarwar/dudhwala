import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { codEligibility } from '@dudhwala/shared';
import { createHash } from 'node:crypto';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentPrincipal, CustomerOnly, Public } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';
import { CartService } from '../cart/cart.service.js';
import { AddressInput } from '../customers/addresses.controller.js';
import { PaymentsService } from '../payments/payments.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CheckoutService } from './checkout.service.js';
import { ENV, type Env } from '../config/env.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';

const Quote = z.object({ areaId: z.string().uuid() }).strict();
const Price = z.object({ areaId: z.string().uuid(), slotKey: z.string().max(80), paymentMethod: z.enum(['ONLINE', 'COD']), couponCode: z.string().trim().toUpperCase().max(40).nullable().optional() }).strict();
const Place = z
  .object({
    address: AddressInput.omit({ label: true, isDefault: true }),
    slotKey: z.string().max(80),
    paymentMethod: z.enum(['ONLINE', 'COD']),
    couponCode: z.string().trim().toUpperCase().max(40).nullable().optional(),
    quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
    acceptedPolicyVersion: z.string().min(1).max(32),
    saveAddress: z.boolean().optional(),
  })
  .strict();
const Cancel = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

/** Checkout requires a customer session (guest checkout = phone OTP at checkout, same security). */
@Controller()
export class CheckoutController {
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(CartService) private readonly carts: CartService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  /** Maintenance mode (DEPLOYMENT_RUNBOOK §8): browsing stays up, ordering and paying pause. */
  private async limitCheckout(p: Principal): Promise<void> {
    await this.limits.hit(LIMITS.checkoutPerCustomer, p.userId);
  }

  private async open(): Promise<void> {
    if (await this.settings.get('storefront.maintenance')) throw new AppError('SERVICE_UNAVAILABLE', 'রক্ষণাবেক্ষণের জন্য এখন অর্ডার নেওয়া বন্ধ আছে। একটু পরে আবার চেষ্টা করুন।');
  }

  private async cartId(p: Principal, req: Request): Promise<string> {
    const cart = await this.carts.find(p, req);
    if (!cart) throw new AppError('VALIDATION_FAILED', 'আপনার কার্ট খালি');
    return cart.id;
  }

  @Post('checkout/quote')
  @CustomerOnly()
  @HttpCode(200)
  async quote(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Req() req: Request) {
    await this.open();
    await this.limitCheckout(p);
    return this.checkout.quote(await this.cartId(p, req), parse(Quote, body).areaId);
  }

  @Post('checkout/price')
  @CustomerOnly()
  @HttpCode(200)
  async price(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Req() req: Request) {
    await this.open();
    await this.limitCheckout(p);
    return this.checkout.price(await this.cartId(p, req), p.userId, parse(Price, body));
  }

  @Post('checkout/orders')
  @CustomerOnly()
  async place(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Headers('idempotency-key') key: string | undefined, @Req() req: Request) {
    await this.open();
    await this.limitCheckout(p);
    if (!key || !/^[A-Za-z0-9-]{16,64}$/.test(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header required');
    const b = parse(Place, body);
    const requestHash = createHash('sha256').update(JSON.stringify(b)).digest('hex');
    // Claim the key atomically (a double-tap sends two requests at once), then compare bodies.
    await this.prisma.$executeRaw`
      INSERT INTO idempotency_record (key, principal, route, request_hash, created_at)
      VALUES (${key}, ${p.userId}, 'checkout.place', ${requestHash}, now())
      ON CONFLICT (key, principal, route) DO NOTHING`;
    const claim = await this.prisma.idempotencyRecord.findUniqueOrThrow({ where: { key_principal_route: { key, principal: p.userId, route: 'checkout.place' } } });
    if (claim.requestHash !== requestHash) throw new AppError('IDEMPOTENCY_CONFLICT', 'Idempotency-Key reused with a different request');
    const findByKey = () =>
      this.prisma.order.findUnique({ where: { userId_idempotencyKey: { userId: p.userId, idempotencyKey: key } }, include: { payments: { take: 1, orderBy: { createdAt: 'desc' } } } });
    const existing = await findByKey();
    if (existing) return replayResult(existing);
    try {
      return await this.checkout.place(p.userId, await this.cartId(p, req), key, b, req);
    } catch (e) {
      // Concurrent request with the same key: whatever the loser hit (unique key, emptied cart,
      // stock taken by the winner), if the winner's order exists the loser returns it.
      const winner = await findByKey();
      if (winner) return replayResult(winner);
      throw e;
    }
  }

  // ── customer orders ──

  @Get('me/orders')
  @CustomerOnly()
  list(@CurrentPrincipal() p: Principal) {
    return this.prisma.order.findMany({
      where: { userId: p.userId },
      select: { id: true, orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, totalPoisha: true, slotStartsAt: true, slotEndsAt: true, createdAt: true, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Get('me/orders/:id')
  @CustomerOnly()
  async detail(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.order.findFirst({
      where: { id, userId: p.userId },
      include: {
        items: { select: { productNameBn: true, productNameEn: true, variantLabelBn: true, unitPricePoisha: true, quantity: true, lineTotalPoisha: true, productVariantId: true } },
        events: { select: { toStatus: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!o) throw notFound('Order');
    const cancelUntil = await this.settings.get('orders.customerCancelUntil');
    const cancellable = o.status === 'PENDING_PAYMENT' || o.status === 'PLACED' || (cancelUntil === 'CONFIRMED' && o.status === 'CONFIRMED');
    return {
      id: o.id, orderNumber: o.orderNumber, status: o.status, paymentStatus: o.paymentStatus, paymentMethod: o.paymentMethod,
      subtotalPoisha: o.subtotalPoisha, discountPoisha: o.discountPoisha, deliveryFeePoisha: o.deliveryFeePoisha, totalPoisha: o.totalPoisha,
      slotStartsAt: o.slotStartsAt, slotEndsAt: o.slotEndsAt, paymentExpiresAt: o.paymentExpiresAt,
      address: { name: o.shipName, phone: o.shipPhone, line1: o.shipLine1, line2: o.shipLine2, landmark: o.shipLandmark, area: o.shipAreaNameBn, instructions: o.shipInstructions },
      items: o.items, timeline: o.events, cancellable, createdAt: o.createdAt,
    };
  }

  @Get('orders/:id/payment-status')
  @CustomerOnly()
  async paymentStatus(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.prisma.order.findFirst({ where: { id, userId: p.userId }, select: { status: true, paymentStatus: true, paymentMethod: true, paymentExpiresAt: true, orderNumber: true } });
    if (!o) throw notFound('Order');
    return o;
  }

  @Post('me/orders/:id/cancel')
  @CustomerOnly()
  @HttpCode(200)
  async cancel(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const { reason } = parse(Cancel, body);
    const o = await this.prisma.order.findFirst({ where: { id, userId: p.userId } });
    if (!o) throw notFound('Order');
    const cancelUntil = await this.settings.get('orders.customerCancelUntil');
    if (o.status === 'CONFIRMED' && cancelUntil !== 'CONFIRMED') throw new AppError('INVALID_TRANSITION', 'নিশ্চিত হওয়া অর্ডার বাতিল করতে আউটলেটে যোগাযোগ করুন');
    return this.orders.transition({ orderId: id, to: 'CANCELLED', actor: 'CUSTOMER', actorUserId: p.userId, actorRole: 'CUSTOMER', reason, customerId: p.userId }, req);
  }

  @Post('me/orders/:id/reorder')
  @CustomerOnly()
  @HttpCode(200)
  async reorder(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const o = await this.prisma.order.findFirst({ where: { id, userId: p.userId }, include: { items: true } });
    if (!o) throw notFound('Order');
    const skipped: string[] = [];
    for (const i of o.items) {
      if (!i.productVariantId) { skipped.push(i.productNameBn); continue; }
      try {
        await this.carts.setQuantity(p, req, res, i.productVariantId, i.quantity);
      } catch {
        skipped.push(i.productNameBn);
      }
    }
    // Current prices apply; the cart view shows them (APP_FLOW §1.4).
    return { cart: await this.carts.viewFor(p, req), skipped };
  }

  // ── payments (customer) ──

  @Post('payments/:orderId/initiate')
  @CustomerOnly()
  @HttpCode(200)
  async initiate(@CurrentPrincipal() p: Principal, @Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: Request) {
    await this.open();
    await this.limits.hit(LIMITS.paymentPerOrder, orderId);
    return this.payments.initiate(orderId, p.userId, req);
  }

  @Post('payments/:orderId/switch-to-cod')
  @CustomerOnly()
  @HttpCode(200)
  async switchToCod(@CurrentPrincipal() p: Principal, @Param('orderId', ParseUUIDPipe) orderId: string, @Req() req: Request) {
    await this.limits.hit(LIMITS.paymentPerOrder, orderId);
    await this.payments.switchToCod(
      orderId,
      p.userId,
      async (o) => {
        const rule = await this.prisma.outletZoneRule.findFirst({ where: { outletId: o.outletId, active: true, zone: { areas: { some: { areaId: o.areaId } } } }, orderBy: { priority: 'asc' } });
        if (!rule) return false;
        const threshold = await this.settings.get('cod.failedDeliveryBlockThreshold');
        // Same failed-delivery count as checkout pricing, so the rule cannot be bypassed by switching later.
        const failed = await this.prisma.order.count({ where: { userId: p.userId, delivery: { attempts: { some: { outcome: { not: 'DELIVERED' } } } } } });
        return codEligibility({ codEnabled: rule.codEnabled, codMaxOrderPoisha: rule.codMaxOrderPoisha }, { totalPoisha: o.totalPoisha, customerFailedDeliveries: failed, failedDeliveryBlockThreshold: threshold }).eligible;
      },
      req,
    );
    return { ok: true };
  }

  // ── gateway webhook ──

  /**
   * SSLCOMMERZ sends the customer's browser back with a form POST. This only
   * redirects to the storefront's polling page (status is never taken from it)
   * and nudges a server-side verification. Path is under /webhooks/ because the
   * gateway's POST cannot carry our CSRF token.
   */
  @Post('webhooks/payments/sslcommerz/return')
  @Public()
  async sslcommerzReturn(@Query('order') order: string, @Query('hint') hint: string, @Body() body: unknown, @Res() res: Response) {
    const orderId = /^[0-9a-f-]{36}$/i.test(order ?? '') ? order : '';
    const h = ['success', 'failed', 'cancelled'].includes(hint) ? hint : 'unknown';
    const tran = typeof (body as { tran_id?: unknown } | null)?.tran_id === 'string' ? (body as { tran_id: string }).tran_id.slice(0, 64) : '';
    if (this.payments.providerCode === 'sslcommerz' && tran) await this.payments.verifyAndApply(tran).catch(() => undefined);
    res.redirect(303, `${this.env.WEB_ORIGIN}/checkout/return?order=${encodeURIComponent(orderId)}&hint=${h}`);
  }

  @Post('webhooks/payments/:provider')
  @Public()
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Req() req: Request) {
    if (provider !== this.payments.providerCode) throw notFound('Provider');
    return this.payments.handleCallback(req, 'IPN');
  }
}

function replayResult(o: { id: string; orderNumber: string; status: string; paymentStatus: string; paymentMethod: string; payments: { id: string }[] }) {
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentId: o.payments[0]?.id ?? null,
    next: o.paymentMethod === 'ONLINE' && o.status === 'PENDING_PAYMENT' ? 'REDIRECT' : 'CONFIRMATION',
    replayed: true,
  };
}
