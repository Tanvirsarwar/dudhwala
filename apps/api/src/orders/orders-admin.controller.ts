import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { OrderStatus as FlowStatus } from '@dudhwala/shared';
import { CurrentPrincipal, StaffRead, StaffWrite } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OrdersService } from './orders.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const StatusPatch = z.object({ status: z.enum(['PLACED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PICKUP_REQUESTED', 'READY_FOR_PICKUP', 'PICKED_UP', 'READY_FOR_COLLECTION', 'COLLECTED', 'CANCELLED']), reason: z.string().trim().max(300).optional() }).strict();
const PaymentPatch = z.object({ paymentStatus: z.enum(['UNPAID', 'PAID']) }).strict();
const ListQuery = z
  .object({
    status: z.string().max(40).optional(),
    method: z.enum(['HOME_DELIVERY', 'EXPRESS_PICKUP', 'BULK_ORDER']).optional(),
    q: z.string().trim().max(60).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .passthrough();


@Controller('admin')
export class OrdersAdminController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Get('orders')
  @StaffRead()
  async list(@Query() query: unknown) {
    const q = parse(ListQuery, query);
    const and: Prisma.OrderWhereInput[] = [];
    if (q.status) and.push({ status: q.status as FlowStatus });
    if (q.method) and.push({ method: q.method });
    if (q.q) and.push({ OR: [{ orderNumber: { contains: q.q.toUpperCase() } }, { contactName: { contains: q.q, mode: 'insensitive' } }, { contactPhone: { contains: q.q.replace(/\s/g, '') } }] });
    const where: Prisma.OrderWhereInput = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({ where, include: { outlet: true, items: { select: { quantity: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit }),
      this.prisma.order.count({ where }),
    ]);
    return {
      data: rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        method: o.method,
        zone: o.zone,
        status: o.status,
        paymentStatus: o.paymentStatus,
        deliveryFeePoisha: o.deliveryFeePoisha,
        totalPoisha: o.totalPoisha,
        itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
        customer: o.contactName,
        outletNameBn: o.outlet.nameBn,
      })),
      total,
      page: q.page,
      limit: q.limit,
    };
  }

  @Get('orders/:id')
  @StaffRead()
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForStaff(id);
  }

  @Patch('orders/:id')
  @StaffWrite()
  async patch(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(StatusPatch, body);
    const o = await this.prisma.$transaction((tx) => this.orders.transition(tx, id, b.status, { actor: p, reason: b.reason ?? null }, req));
    return this.orders.staffView(o);
  }

  /** Record that the cash was collected (or undo a mistake). Delivery status is unaffected. */
  @Patch('orders/:id/payment')
  @StaffWrite()
  async payment(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.orders.staffView(await this.orders.setPaymentStatus(id, parse(PaymentPatch, body).paymentStatus, p, req));
  }

  @Get('summary')
  @StaffRead()
  async summary() {
    const [products, byCategory, noPrice, noImage, outOfStock, orders, byStatus, byMethod, items, latest] = await Promise.all([
      this.prisma.product.groupBy({ by: ['active'], _count: true }),
      this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, include: { products: { select: { active: true } } } }),
      this.prisma.product.count({ where: { variants: { some: { pricePoisha: null } } } }),
      this.prisma.product.count({ where: { imageKey: null } }),
      this.outOfStockCount(),
      this.orderTotals(),
      this.prisma.order.groupBy({ by: ['status'], _count: true }),
      this.prisma.order.groupBy({ by: ['method'], _count: true }),
      this.prisma.orderItem.aggregate({ _sum: { quantity: true } }),
      this.prisma.order.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { outlet: true, items: { select: { quantity: true } } } }),
    ]);
    const count = (a: boolean) => products.find((x) => x.active === a)?._count ?? 0;
    return {
      products: {
        total: count(true) + count(false),
        active: count(true),
        hidden: count(false),
        noPrice,
        noImage,
        outOfStock,
        byCategory: byCategory.map((c) => ({ slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn, count: c.products.length, active: c.products.filter((x) => x.active).length })),
      },
      orders: {
        total: orders.total,
        today: orders.today,
        open: orders.open,
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
        byMethod: Object.fromEntries(byMethod.map((m) => [m.method, m._count])),
        itemsOrdered: items._sum.quantity ?? 0,
        knownRevenuePoisha: orders.revenuePoisha,
        ordersWithUnknownPrice: 0,
        latest: latest.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          createdAt: o.createdAt,
          method: o.method,
          zone: o.zone,
          status: o.status,
          totalPoisha: o.totalPoisha,
          itemCount: o.items.reduce((s, i) => s + i.quantity, 0),
          customer: o.contactName,
          outletNameBn: o.outlet.nameBn,
        })),
      },
    };
  }

  private async orderTotals() {
    const now = this.clock.now();
    const dayStart = new Date(`${new Date(now.getTime() + 6 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+06:00`);
    const [total, today, open, revenue] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.order.count({ where: { createdAt: { gte: dayStart } } }),
      this.prisma.order.count({ where: { status: { notIn: ['DELIVERED', 'PICKED_UP', 'COLLECTED', 'CANCELLED'] } } }),
      this.prisma.order.aggregate({ where: { status: { not: 'CANCELLED' } }, _sum: { totalPoisha: true } }),
    ]);
    return { total, today, open, revenuePoisha: revenue._sum.totalPoisha ?? 0 };
  }

  /** Products whose every counted variant has nothing left anywhere (products with an uncounted variant are never "out"). */
  private async outOfStockCount(): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM product p
      WHERE NOT EXISTS (
        SELECT 1 FROM product_variant v
        WHERE v.product_id = p.id AND (NOT v.track_stock OR EXISTS (
          SELECT 1 FROM inventory i JOIN outlet o ON o.id = i.outlet_id
          WHERE i.product_variant_id = v.id AND o.status = 'ACTIVE' AND i.quantity_on_hand - i.reserved_quantity > 0)))`;
    return rows[0]?.n ?? 0;
  }

  @Get('audit')
  @StaffRead()
  async audit(@Query() query: unknown) {
    const q = parse(z.object({ entityType: z.string().max(48).optional(), entityId: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).passthrough(), query);
    const rows = await this.prisma.auditLog.findMany({
      where: { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return { data: rows.map((r) => ({ id: r.id, at: r.createdAt, actorRole: r.actorRole, actorUserId: r.actorUserId, action: r.action, entityType: r.entityType, entityId: r.entityId, before: r.before, after: r.after })) };
  }
}
