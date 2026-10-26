import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, outletScope, type StaffPrincipal } from '../access/principal.js';
import { PaymentsService } from '../payments/payments.service.js';
import { dhakaDate } from '../delivery/slots.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Range = z.object({ from: date.optional(), to: date.optional(), outletId: z.string().uuid().optional(), format: z.enum(['json', 'csv']).default('json') }).strict();
const CouponIn = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,40}$/),
    type: z.enum(['PERCENT', 'FIXED', 'FREE_DELIVERY']),
    value: z.number().int().min(0).max(100_000_000),
    maxDiscountPoisha: z.number().int().positive().nullable().default(null),
    minOrderPoisha: z.number().int().min(0).default(0),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
    usageLimitTotal: z.number().int().positive().nullable().default(null),
    usageLimitPerCustomer: z.number().int().positive().nullable().default(null),
    outletIds: z.array(z.string().uuid()).default([]),
    firstOrderOnly: z.boolean().default(false),
    active: z.boolean().default(false),
  })
  .strict()
  .refine((c) => (c.type === 'PERCENT' ? c.value >= 1 && c.value <= 10_000 : c.type === 'FIXED' ? c.value > 0 : true), 'invalid value for type');

/** CSV with formula-injection protection (cells starting = + - @ are prefixed with '). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] as object);
  const cell = (v: unknown) => {
    let s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\n') + '\n';
}

/** Payments, refunds, coupons, reports and audit (Super Admin; outlet reports for managers). */
@Controller('admin')
export class FinanceController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private range(q: { from?: string; to?: string }) {
    const to = q.to ?? dhakaDate(this.clock.now());
    const from = q.from ?? to;
    const start = new Date(`${from}T00:00:00+06:00`);
    const end = new Date(new Date(`${to}T00:00:00+06:00`).getTime() + 86_400_000);
    if (end.getTime() - start.getTime() > 366 * 86_400_000) throw new AppError('VALIDATION_FAILED', 'Range too long (max 1 year)');
    if (end <= start) throw new AppError('VALIDATION_FAILED', 'from must be before to');
    return { start, end, from, to };
  }

  // ── payments & refunds ──

  @Get('payments')
  @RequirePermission('payments.reconcile')
  paymentsList(@Query() query: unknown) {
    const q = parse(z.object({ status: z.enum(['UNPAID', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED']).optional() }).strict(), query);
    return this.prisma.payment.findMany({ where: { method: 'ONLINE', ...(q.status ? { status: q.status } : {}) }, include: { order: { select: { orderNumber: true, outletId: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  @Get('payments/:id')
  @RequirePermission('payments.read_raw_events')
  async payment(@Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.payment.findUnique({ where: { id }, include: { events: { orderBy: { receivedAt: 'asc' } }, refunds: true, order: { select: { orderNumber: true, status: true } } } });
    if (!p) throw notFound('Payment');
    return p;
  }

  @Post('payments/:id/verify')
  @RequirePermission('payments.reconcile')
  @HttpCode(200)
  async verify(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const pay = await this.prisma.payment.findUnique({ where: { id } });
    if (!pay) throw notFound('Payment');
    const result = await this.payments.verifyAndApply(pay.merchantTranId);
    await this.audit.record({ action: 'payment.manual_verify', entityType: 'payment', entityId: id, after: { result } }, { principal: p }, req);
    return { result };
  }

  /** Items needing a human: stuck pending, duplicate captures, refund requests, COD discrepancies. */
  @Get('reconciliation/exceptions')
  @RequirePermission('payments.reconcile')
  async exceptions() {
    const stale = new Date(this.clock.now().getTime() - 30 * 60_000);
    const [pending, duplicates, refunds, cod] = await Promise.all([
      this.prisma.payment.findMany({ where: { status: 'PENDING', updatedAt: { lt: stale } }, include: { order: { select: { orderNumber: true } } } }),
      this.prisma.payment.findMany({ where: { duplicateCapture: true, status: 'PAID' }, include: { order: { select: { orderNumber: true } } } }),
      this.prisma.refund.findMany({ where: { status: { in: ['REQUESTED', 'FAILED', 'SUBMITTED'] } }, include: { payment: { select: { merchantTranId: true, order: { select: { orderNumber: true } } } } } }),
      this.prisma.codCollection.findMany({ where: { status: 'DISCREPANCY' }, include: { delivery: { select: { order: { select: { orderNumber: true } } } } } }),
    ]);
    return { stalePending: pending, duplicateCaptures: duplicates, refunds, codDiscrepancies: cod };
  }

  @Post('refunds/:id/execute')
  @RequirePermission('payments.refund')
  @HttpCode(200)
  executeRefund(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.payments.executeRefund(id, p.userId, req);
  }

  // ── coupons ──

  @Get('coupons')
  @RequirePermission('coupons.manage')
  coupons() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Post('coupons')
  @RequirePermission('coupons.manage')
  async createCoupon(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CouponIn, body);
    if (await this.prisma.coupon.findUnique({ where: { code: b.code } })) throw new AppError('CONFLICT', 'Coupon code exists');
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.coupon.create({ data: { id: newId(), ...b } });
      await this.audit.record({ action: 'coupon.create', entityType: 'coupon', entityId: c.id, after: { ...b, startsAt: b.startsAt?.toISOString() ?? null, endsAt: b.endsAt?.toISOString() ?? null } }, { principal: p }, req, tx);
      return c;
    });
  }

  @Patch('coupons/:id')
  @RequirePermission('coupons.manage')
  async updateCoupon(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ active: z.boolean().optional(), endsAt: z.coerce.date().nullable().optional(), usageLimitTotal: z.number().int().positive().nullable().optional() }).strict(), body);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.coupon.findUnique({ where: { id } }))) throw notFound('Coupon');
      const c = await tx.coupon.update({ where: { id }, data: b });
      await this.audit.record({ action: 'coupon.update', entityType: 'coupon', entityId: id, after: { ...b, endsAt: b.endsAt?.toISOString() ?? null } }, { principal: p }, req, tx);
      return c;
    });
  }

  // ── reports ──

  @Get('reports/sales')
  @RequirePermission('reports.outlet')
  async sales(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const q = parse(Range, query);
    const outletIds = this.reportScope(p, q.outletId);
    const { start, end, from, to } = this.range(q);
    const rows = await this.prisma.$queryRaw<{ day: string; outlet_code: string; orders: bigint; gross_poisha: bigint; discount_poisha: bigint; delivery_fee_poisha: bigint; cod_orders: bigint; online_orders: bigint }[]>`
      SELECT to_char(o.created_at AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD') AS day, ot.code AS outlet_code,
             COUNT(*) AS orders, SUM(o.total_poisha) AS gross_poisha, SUM(o.discount_poisha) AS discount_poisha,
             SUM(o.delivery_fee_poisha) AS delivery_fee_poisha,
             COUNT(*) FILTER (WHERE o.payment_method = 'COD') AS cod_orders,
             COUNT(*) FILTER (WHERE o.payment_method = 'ONLINE') AS online_orders
      FROM "order" o JOIN outlet ot ON ot.id = o.outlet_id
      WHERE o.created_at >= ${start} AND o.created_at < ${end}
        AND o.status NOT IN ('CANCELLED', 'REJECTED', 'EXPIRED', 'PENDING_PAYMENT')
        AND (${outletIds === null} OR o.outlet_id = ANY(${outletIds ?? []}::uuid[]))
      GROUP BY 1, 2 ORDER BY 1, 2`;
    const data = rows.map((r) => ({ day: r.day, outlet: r.outlet_code, orders: Number(r.orders), grossPoisha: Number(r.gross_poisha), discountPoisha: Number(r.discount_poisha), deliveryFeePoisha: Number(r.delivery_fee_poisha), codOrders: Number(r.cod_orders), onlineOrders: Number(r.online_orders) }));
    return this.output('sales', data, q.format, p, req, res, { from, to });
  }

  @Get('reports/inventory')
  @RequirePermission('reports.outlet')
  async inventory(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const q = parse(Range, query);
    const outletIds = this.reportScope(p, q.outletId);
    const rows = await this.prisma.inventory.findMany({
      where: outletIds ? { outletId: { in: outletIds } } : {},
      include: { outlet: { select: { code: true } }, variant: { select: { sku: true, labelBn: true, product: { select: { nameBn: true } } } } },
      orderBy: [{ outlet: { code: 'asc' } }, { variant: { sku: 'asc' } }],
    });
    const data = rows.map((r) => ({ outlet: r.outlet.code, sku: r.variant.sku, name: `${r.variant.product.nameBn} — ${r.variant.labelBn}`, onHand: r.quantityOnHand, reserved: r.reservedQuantity, available: r.quantityOnHand - r.reservedQuantity, lowStock: r.quantityOnHand - r.reservedQuantity <= r.lowStockThreshold, listed: r.isListed }));
    return this.output('inventory', data, q.format, p, req, res, {});
  }

  @Get('reports/delivery')
  @RequirePermission('reports.outlet')
  async delivery(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const q = parse(Range, query);
    const outletIds = this.reportScope(p, q.outletId);
    const { start, end, from, to } = this.range(q);
    const rows = await this.prisma.deliveryAttempt.groupBy({
      by: ['outcome'],
      where: { recordedAt: { gte: start, lt: end }, ...(outletIds ? { delivery: { outletId: { in: outletIds } } } : {}) },
      _count: { _all: true },
    });
    return this.output('delivery', rows.map((r) => ({ outcome: r.outcome, attempts: r._count._all })), q.format, p, req, res, { from, to });
  }

  @Get('reports/cod')
  @RequirePermission('reports.outlet')
  async codReport(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
    const q = parse(Range, query);
    const outletIds = this.reportScope(p, q.outletId);
    const { start, end, from, to } = this.range(q);
    const rows = await this.prisma.codCollection.groupBy({
      by: ['outletId', 'status'],
      where: { ...(outletIds ? { outletId: { in: outletIds } } : {}), delivery: { order: { createdAt: { gte: start, lt: end } } } },
      _sum: { expectedPoisha: true, collectedPoisha: true },
      _count: { _all: true },
    });
    return this.output('cod', rows.map((r) => ({ outletId: r.outletId, status: r.status, count: r._count._all, expectedPoisha: r._sum.expectedPoisha ?? 0, collectedPoisha: r._sum.collectedPoisha ?? 0 })), q.format, p, req, res, { from, to });
  }

  /** Managers see their outlet only; Super Admin sees all or one (`reports.consolidated`). */
  private reportScope(p: StaffPrincipal, outletId: string | undefined): string[] | null {
    if (p.staff.role === 'SUPER_ADMIN') return outletId ? [outletId] : null;
    if (outletId) assertOutletInScope(p, outletId);
    const scope = outletScope(p);
    return scope === 'ALL' ? null : [...scope];
  }

  private async output(name: string, data: Record<string, unknown>[], format: 'json' | 'csv', p: StaffPrincipal, req: Request, res: Response, meta: Record<string, unknown>) {
    if (format === 'json') return { data, ...meta };
    if (!p.staff.permissions.has('orders.export_csv')) throw new AppError('FORBIDDEN', 'CSV export permission required');
    await this.audit.record({ action: 'report.export_csv', entityType: 'report', entityId: name, outletId: p.staff.outletId, after: { rows: data.length, ...meta } }, { principal: p }, req);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="dudhwala-${name}-${dhakaDate(this.clock.now())}.csv"`);
    return '﻿' + toCsv(data); // BOM so Excel shows Bangla correctly
  }

  // ── audit ──

  @Get('audit')
  @RequirePermission('audit.read')
  async auditLog(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown) {
    const q = parse(z.object({ action: z.string().max(64).optional(), entityId: z.string().max(64).optional(), outletId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).max(1000).default(1) }).strict(), query);
    const scope = outletScope(p);
    if (q.outletId) assertOutletInScope(p, q.outletId);
    const where = {
      ...(scope === 'ALL' ? (q.outletId ? { outletId: q.outletId } : {}) : { outletId: { in: [...scope] } }),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
    };
    return this.prisma.auditLog.findMany({ where, include: { actor: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * 100, take: 100 });
  }

  @Get('dashboard')
  @RequirePermission('orders.read')
  async dashboard(@CurrentPrincipal() p: StaffPrincipal) {
    if (p.staff.role === 'DELIVERY_STAFF') throw new AppError('FORBIDDEN', 'Use the rider app');
    const scope = outletScope(p);
    const where = scope === 'ALL' ? {} : { outletId: { in: [...scope] } };
    const today = dhakaDate(this.clock.now());
    const start = new Date(`${today}T00:00:00+06:00`);
    const end = new Date(start.getTime() + 86_400_000);
    const [byStatus, todayAgg, lowStock, late] = await Promise.all([
      this.prisma.order.groupBy({ by: ['status'], where: { ...where, status: { notIn: ['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED'] } }, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { ...where, createdAt: { gte: start, lt: end }, status: { notIn: ['CANCELLED', 'REJECTED', 'EXPIRED', 'PENDING_PAYMENT'] } }, _sum: { totalPoisha: true }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM inventory WHERE is_listed AND quantity_on_hand - reserved_quantity <= low_stock_threshold AND (${scope === 'ALL'} OR outlet_id = ANY(${scope === 'ALL' ? [] : [...scope]}::uuid[]))`,
      this.prisma.order.count({ where: { ...where, slotEndsAt: { lt: this.clock.now() }, status: { in: ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH'] } } }),
    ]);
    return {
      date: today,
      openByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
      todayOrders: todayAgg._count._all,
      todayRevenuePoisha: todayAgg._sum.totalPoisha ?? 0,
      lowStockItems: Number(lowStock[0]?.n ?? 0),
      lateOrders: late,
    };
  }
}
