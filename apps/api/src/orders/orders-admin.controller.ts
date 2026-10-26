import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { allowedOrderTransitions, ORDER_STATUSES, type OrderStatus, type Permission } from '@dudhwala/shared';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, outletScope, type StaffPrincipal } from '../access/principal.js';
import { OrdersService } from './orders.service.js';
import { dhakaDate } from '../delivery/slots.js';

const ListQuery = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    q: z.string().trim().max(40).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
  })
  .strict();
const Transition = z
  .object({ to: z.enum(ORDER_STATUSES), reason: z.string().trim().max(300).optional(), returnedGoods: z.enum(['RESTOCK', 'WRITE_OFF']).optional() })
  .strict();
const Assign = z.object({ riderUserId: z.string().uuid() }).strict();
const Reschedule = z.object({ slotId: z.string().uuid() }).strict();

/** Permission needed to move an order INTO each status (USER_ROLES_AND_PERMISSIONS §3 Orders). */
const TARGET_PERMISSION: Partial<Record<OrderStatus, Permission>> = {
  CONFIRMED: 'orders.confirm',
  REJECTED: 'orders.reject',
  PREPARING: 'orders.prepare',
  READY_FOR_DISPATCH: 'orders.prepare',
  OUT_FOR_DELIVERY: 'delivery.update_status',
  DELIVERED: 'delivery.update_status',
  DELIVERY_FAILED: 'delivery.update_status',
  CANCELLED: 'orders.cancel',
};

/** Riders use /rider/deliveries only; the order board shows other customers' data. */
function notRider(p: StaffPrincipal): void {
  if (p.staff.role === 'DELIVERY_STAFF') throw new AppError('FORBIDDEN', 'Use the rider app');
}

/** Outlet order board (APP_FLOW §2.1). Every query is outlet-scoped; foreign ids are 404. */
@Controller('admin')
export class OrdersAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Get('orders')
  @RequirePermission('orders.read')
  async listAll(@CurrentPrincipal() p: StaffPrincipal, @Query() query: unknown) {
    notRider(p);
    const q = parse(ListQuery.extend({ outletId: z.string().uuid().optional() }).strict(), query);
    const scope = outletScope(p);
    if (q.outletId) assertOutletInScope(p, q.outletId);
    const outletIds = q.outletId ? [q.outletId] : scope === 'ALL' ? undefined : [...scope];
    return this.list(outletIds, q);
  }

  @Get('outlets/:outletId/orders')
  @RequirePermission('orders.read')
  async listOutlet(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Query() query: unknown) {
    notRider(p);
    assertOutletInScope(p, outletId);
    return this.list([outletId], parse(ListQuery, query));
  }

  private async list(outletIds: string[] | undefined, q: z.infer<typeof ListQuery>) {
    const take = 50;
    const where = {
      ...(outletIds ? { outletId: { in: outletIds } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.date ? { slotStartsAt: { gte: new Date(`${q.date}T00:00:00+06:00`), lt: new Date(new Date(`${q.date}T00:00:00+06:00`).getTime() + 86_400_000) } } : {}),
      ...(q.q ? { OR: [{ orderNumber: { contains: q.q.toUpperCase() } }, { shipPhone: { contains: q.q.replace(/\D/g, '') || '__none__' } }] } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: {
          id: true, orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, totalPoisha: true, slotStartsAt: true, slotEndsAt: true, createdAt: true,
          shipName: true, shipAreaNameBn: true, outlet: { select: { id: true, code: true } }, delivery: { select: { status: true, riderUserId: true } }, _count: { select: { items: true } },
        },
        orderBy: [{ slotStartsAt: 'asc' }, { createdAt: 'asc' }],
        skip: (q.page - 1) * take,
        take,
      }),
      this.prisma.order.count({ where }),
    ]);
    const now = this.clock.now();
    return { data: rows.map((r) => ({ ...r, late: r.slotEndsAt < now && !['DELIVERED', 'CANCELLED', 'REJECTED', 'EXPIRED', 'OUT_FOR_DELIVERY'].includes(r.status) })), total, page: q.page };
  }

  @Get('orders/:orderId')
  @RequirePermission('orders.read')
  async detail(@CurrentPrincipal() p: StaffPrincipal, @Param('orderId', ParseUUIDPipe) orderId: string) {
    notRider(p);
    const scope = outletScope(p);
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, ...(scope === 'ALL' ? {} : { outletId: { in: [...scope] } }) },
      include: {
        items: true,
        events: { orderBy: { createdAt: 'asc' } },
        payments: { select: { id: true, method: true, status: true, amountPoisha: true, paidAmountPoisha: true, refundedPoisha: true, verifiedAt: true, duplicateCapture: true, createdAt: true } },
        delivery: { include: { attempts: { orderBy: { attemptNo: 'asc' } }, cod: true, rider: { select: { id: true, fullName: true, phone: true } } } },
        outlet: { select: { id: true, code: true, nameBn: true } },
      },
    });
    if (!o) throw notFound('Order');
    const actor = p.staff.role === 'DELIVERY_STAFF' ? 'RIDER' : 'STAFF';
    const next = allowedOrderTransitions(o.status as OrderStatus, actor).filter((t) => {
      const perm = TARGET_PERMISSION[t];
      return !perm || p.staff.permissions.has(perm);
    });
    return { ...o, allowedTransitions: next };
  }

  @Post('orders/:orderId/transition')
  @RequirePermission('orders.read')
  @HttpCode(200)
  async transition(@CurrentPrincipal() p: StaffPrincipal, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: unknown, @Req() req: Request) {
    notRider(p);
    const b = parse(Transition, body);
    const perm = TARGET_PERMISSION[b.to];
    if (!perm || !p.staff.permissions.has(perm)) throw new AppError('FORBIDDEN', 'Permission denied');
    return this.orders.transition(
      { orderId, to: b.to, actor: 'STAFF', actorUserId: p.userId, actorRole: p.staff.role, reason: b.reason ?? null, returnedGoods: b.returnedGoods, outletScope: outletScope(p) },
      req,
    );
  }

  @Post('orders/:orderId/assign-rider')
  @RequirePermission('delivery.assign')
  @HttpCode(200)
  async assign(@CurrentPrincipal() p: StaffPrincipal, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: unknown, @Req() req: Request) {
    const { riderUserId } = parse(Assign, body);
    const scope = outletScope(p);
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.order.findFirst({ where: { id: orderId, ...(scope === 'ALL' ? {} : { outletId: { in: [...scope] } }) }, include: { delivery: true } });
      if (!o || !o.delivery) throw notFound('Order');
      if (!['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH'].includes(o.status)) throw new AppError('CONFLICT', 'Riders can be assigned only before dispatch');
      // The rider must be an active delivery staff member of the SAME outlet.
      const rider = await tx.outletStaff.findFirst({ where: { userId: riderUserId, outletId: o.outletId, active: true, role: { code: 'DELIVERY_STAFF' }, user: { status: 'ACTIVE' } } });
      if (!rider) throw notFound('Rider');
      await tx.delivery.update({ where: { id: o.delivery.id }, data: { riderUserId, status: 'ASSIGNED', assignedById: p.userId, assignedAt: this.clock.now() } });
      await this.audit.record({ action: 'delivery.assign', entityType: 'delivery', entityId: o.delivery.id, outletId: o.outletId, after: { riderUserId } }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  @Get('outlets/:outletId/riders')
  @RequirePermission('delivery.assign')
  riders(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return this.prisma.outletStaff.findMany({ where: { outletId, active: true, role: { code: 'DELIVERY_STAFF' } }, select: { user: { select: { id: true, fullName: true, phone: true } } } }).then((r) => r.map((x) => x.user));
  }

  /** Moves a failed (or not yet dispatched) order into another slot at the same outlet; capacity enforced. */
  @Post('orders/:orderId/reschedule')
  @RequirePermission('orders.reschedule')
  @HttpCode(200)
  async reschedule(@CurrentPrincipal() p: StaffPrincipal, @Param('orderId', ParseUUIDPipe) orderId: string, @Body() body: unknown, @Req() req: Request) {
    const { slotId } = parse(Reschedule, body);
    const scope = outletScope(p);
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.order.findFirst({ where: { id: orderId, ...(scope === 'ALL' ? {} : { outletId: { in: [...scope] } }) } });
      if (!o) throw notFound('Order');
      if (!['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'DELIVERY_FAILED'].includes(o.status)) throw new AppError('CONFLICT', 'This order cannot be rescheduled now');
      const booked = await tx.$queryRaw<{ id: string; starts_at: Date; ends_at: Date }[]>`
        UPDATE delivery_slot SET booked_count = booked_count + 1
        WHERE id = ${slotId}::uuid AND outlet_id = ${o.outletId}::uuid AND status = 'OPEN' AND starts_at > ${this.clock.now()} AND booked_count < capacity
        RETURNING id, starts_at, ends_at`;
      const slot = booked[0];
      if (!slot) throw new AppError('SLOT_FULL', 'That slot is full or closed');
      if (o.status !== 'DELIVERY_FAILED') await tx.$executeRaw`UPDATE delivery_slot SET booked_count = booked_count - 1 WHERE id = ${o.deliverySlotId}::uuid AND booked_count > 0`;
      await tx.order.update({ where: { id: o.id }, data: { deliverySlotId: slot.id, slotStartsAt: slot.starts_at, slotEndsAt: slot.ends_at } });
      await this.audit.record({ action: 'order.reschedule', entityType: 'order', entityId: o.id, outletId: o.outletId, before: { slotId: o.deliverySlotId }, after: { slotId } }, { principal: p }, req, tx);
      if (o.status === 'DELIVERY_FAILED') {
        await this.orders.transitionInTx(tx, { orderId: o.id, to: 'READY_FOR_DISPATCH', actor: 'STAFF', actorUserId: p.userId, actorRole: p.staff.role, reason: 'rescheduled', outletScope: scope }, req);
        await tx.delivery.update({ where: { orderId: o.id }, data: { status: 'ASSIGNED' } });
      }
      return { ok: true, slotStartsAt: slot.starts_at };
    });
  }

  /** Aggregated pick list for a slot or day (what to pack). */
  @Get('outlets/:outletId/picklist')
  @RequirePermission('orders.prepare')
  async picklist(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Query() query: unknown) {
    assertOutletInScope(p, outletId);
    const q = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(), query);
    const date = q.date ?? dhakaDate(this.clock.now());
    const start = new Date(`${date}T00:00:00+06:00`);
    const items = await this.prisma.orderItem.groupBy({
      by: ['sku', 'productNameBn', 'variantLabelBn'],
      where: { order: { outletId, status: { in: ['CONFIRMED', 'PREPARING'] }, slotStartsAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } } },
      _sum: { quantity: true },
      orderBy: { sku: 'asc' },
    });
    return { date, lines: items.map((i) => ({ sku: i.sku, name: `${i.productNameBn} — ${i.variantLabelBn}`, quantity: i._sum.quantity ?? 0 })) };
  }

  /** COD cash handover: manager confirms cash received from the rider (separation of duties). */
  @Get('outlets/:outletId/cod')
  @RequirePermission('cod.confirm_handover')
  cod(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Query() query: unknown) {
    assertOutletInScope(p, outletId);
    const q = parse(z.object({ status: z.enum(['PENDING', 'COLLECTED', 'HANDED_OVER', 'DISCREPANCY', 'NOT_COLLECTED']).optional() }).strict(), query);
    return this.prisma.codCollection.findMany({
      where: { outletId, ...(q.status ? { status: q.status } : {}) },
      include: { delivery: { select: { order: { select: { id: true, orderNumber: true } }, rider: { select: { id: true, fullName: true } } } } },
      orderBy: { collectedAt: 'desc' },
      take: 200,
    });
  }

  @Post('cod/:id/confirm-handover')
  @RequirePermission('cod.confirm_handover')
  @HttpCode(200)
  async confirmHandover(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const scope = outletScope(p);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.codCollection.findFirst({ where: { id, ...(scope === 'ALL' ? {} : { outletId: { in: [...scope] } }) }, include: { delivery: true } });
      if (!c) throw notFound('COD record');
      if (c.status !== 'COLLECTED') throw new AppError('CONFLICT', `COD is ${c.status}; only COLLECTED cash can be handed over`);
      if (c.collectedById === p.userId) throw new AppError('FORBIDDEN', 'The collector cannot confirm their own handover');
      await tx.codCollection.update({ where: { id }, data: { status: 'HANDED_OVER', receivedById: p.userId, receivedAt: this.clock.now() } });
      await tx.payment.updateMany({ where: { orderId: c.delivery.orderId, method: 'COD', status: 'UNPAID' }, data: { status: 'PAID', paidAmountPoisha: c.collectedPoisha } });
      await tx.order.update({ where: { id: c.delivery.orderId }, data: { paymentStatus: 'PAID' } });
      await this.audit.record({ action: 'cod.handover', entityType: 'cod_collection', entityId: id, outletId: c.outletId, after: { collectedPoisha: c.collectedPoisha } }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  @Post('cod/:id/resolve')
  @RequirePermission('cod.resolve_discrepancy')
  @HttpCode(200)
  async resolve(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ receivedPoisha: z.number().int().min(0), note: z.string().trim().min(3).max(300) }).strict(), body);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.codCollection.findUnique({ where: { id }, include: { delivery: true } });
      if (!c) throw notFound('COD record');
      if (c.status !== 'DISCREPANCY') throw new AppError('CONFLICT', 'Only discrepancies can be resolved');
      await tx.codCollection.update({ where: { id }, data: { status: 'HANDED_OVER', collectedPoisha: b.receivedPoisha, receivedById: p.userId, receivedAt: this.clock.now(), note: `${c.note ?? ''}\nResolved: ${b.note}`.trim() } });
      await tx.payment.updateMany({ where: { orderId: c.delivery.orderId, method: 'COD', status: 'UNPAID' }, data: { status: 'PAID', paidAmountPoisha: b.receivedPoisha } });
      await tx.order.update({ where: { id: c.delivery.orderId }, data: { paymentStatus: 'PAID' } });
      await this.audit.record({ action: 'cod.resolve', entityType: 'cod_collection', entityId: id, outletId: c.outletId, before: { expected: c.expectedPoisha, collected: c.collectedPoisha }, after: b }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  /** Writes the attempt log for a delivery (used by riders and by staff on their behalf). */
  static async recordAttempt(tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0], deliveryId: string, outcome: 'DELIVERED' | 'CUSTOMER_UNAVAILABLE' | 'WRONG_ADDRESS' | 'REFUSED' | 'OTHER', note: string | null, clientUpdateId: string, userId: string) {
    const n = await tx.deliveryAttempt.count({ where: { deliveryId } });
    await tx.deliveryAttempt.create({ data: { id: newId(), deliveryId, attemptNo: n + 1, outcome, note, clientUpdateId, recordedById: userId } });
  }
}
