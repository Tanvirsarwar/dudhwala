import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { newId } from '../common/crypto.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { OrdersService } from './orders.service.js';
import { OrdersAdminController } from './orders-admin.controller.js';

/** Contact details stay visible this long after a delivery closes (USER_ROLES_AND_PERMISSIONS §4). */
export const RIDER_CONTACT_GRACE_MS = 2 * 3_600_000;

const clientUpdateId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/);
const Status = z.object({ to: z.enum(['ARRIVED']), clientUpdateId }).strict();
const Complete = z.object({ codCollectedPoisha: z.number().int().min(0).max(100_000_000).optional(), note: z.string().trim().max(300).optional(), clientUpdateId }).strict();
const Fail = z.object({ reason: z.enum(['CUSTOMER_UNAVAILABLE', 'WRONG_ADDRESS', 'REFUSED', 'OTHER']), note: z.string().trim().min(3).max(300), clientUpdateId }).strict();

/**
 * Rider app API (APP_FLOW §4). Riders see only deliveries assigned to them,
 * with minimal data, and only while active (+ short grace). Updates carry a
 * client-generated id so offline retries never apply twice.
 */
@Controller('rider/deliveries')
export class RiderController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private visibleWhere(p: StaffPrincipal) {
    const graceStart = new Date(this.clock.now().getTime() - RIDER_CONTACT_GRACE_MS);
    return { riderUserId: p.userId, outletId: p.staff.outletId ?? '__none__', OR: [{ closedAt: null }, { closedAt: { gt: graceStart } }] };
  }

  @Get()
  @RequirePermission('delivery.update_status')
  async list(@CurrentPrincipal() p: StaffPrincipal) {
    if (p.staff.role !== 'DELIVERY_STAFF') throw new AppError('FORBIDDEN', 'Rider accounts only');
    const rows = await this.prisma.delivery.findMany({
      where: this.visibleWhere(p),
      include: { order: { select: { id: true, orderNumber: true, status: true, slotStartsAt: true, slotEndsAt: true, shipName: true, shipPhone: true, shipLine1: true, shipLine2: true, shipLandmark: true, shipAreaNameBn: true, shipInstructions: true, paymentMethod: true, items: { select: { productNameBn: true, variantLabelBn: true, quantity: true } } } }, cod: { select: { expectedPoisha: true, status: true } } },
      orderBy: { order: { slotStartsAt: 'asc' } },
    });
    return rows.map((d) => ({
      deliveryId: d.id,
      status: d.status,
      order: d.order,
      collectPoisha: d.order.paymentMethod === 'COD' && d.cod?.status === 'PENDING' ? d.cod.expectedPoisha : 0,
    }));
  }

  private async load(p: StaffPrincipal, id: string) {
    const d = await this.prisma.delivery.findFirst({ where: { id, ...this.visibleWhere(p) }, include: { order: true, cod: true } });
    if (!d) throw notFound('Delivery');
    return d;
  }

  private async replay(clientUpdate: string): Promise<boolean> {
    return (await this.prisma.auditLog.count({ where: { action: { startsWith: 'rider.' }, requestId: `cu:${clientUpdate}` } })) > 0;
  }

  @Post(':id/status')
  @RequirePermission('delivery.update_status')
  @HttpCode(200)
  async status(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(Status, body);
    const d = await this.load(p, id);
    if (await this.replay(b.clientUpdateId)) return { ok: true, replayed: true };
    if (d.order.status !== 'OUT_FOR_DELIVERY') throw new AppError('CONFLICT', 'Delivery is not on the way');
    await this.prisma.$transaction(async (tx) => {
      await tx.delivery.update({ where: { id }, data: { status: 'ARRIVED' } });
      await tx.auditLog.create({ data: { id: newId(), actorUserId: p.userId, actorRole: 'DELIVERY_STAFF', outletId: d.outletId, action: 'rider.arrived', entityType: 'delivery', entityId: id, requestId: `cu:${b.clientUpdateId}`, createdAt: this.clock.now() } });
    });
    return { ok: true };
  }

  @Post(':id/complete')
  @RequirePermission('delivery.record_attempt')
  @HttpCode(200)
  async complete(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(Complete, body);
    const d = await this.load(p, id);
    if (await this.prisma.deliveryAttempt.findUnique({ where: { clientUpdateId: b.clientUpdateId } })) return { ok: true, replayed: true };
    if (d.order.paymentMethod === 'COD' && b.codCollectedPoisha === undefined) throw new AppError('VALIDATION_FAILED', 'Enter the cash collected');
    await this.prisma.$transaction(async (tx) => {
      await OrdersAdminController.recordAttempt(tx, id, 'DELIVERED', b.note ?? null, b.clientUpdateId, p.userId);
      if (d.cod && d.order.paymentMethod === 'COD') {
        const collected = b.codCollectedPoisha ?? 0;
        const status = collected === d.cod.expectedPoisha ? 'COLLECTED' : 'DISCREPANCY';
        if (status === 'DISCREPANCY' && !b.note) throw new AppError('VALIDATION_FAILED', 'Explain why the amount differs');
        await tx.codCollection.update({ where: { id: d.cod.id }, data: { status, collectedPoisha: collected, collectedById: p.userId, collectedAt: this.clock.now(), note: b.note ?? null } });
      }
      await this.orders.transitionInTx(tx, { orderId: d.orderId, to: 'DELIVERED', actor: 'RIDER', actorUserId: p.userId, actorRole: 'DELIVERY_STAFF', outletScope: [d.outletId] }, req);
    });
    return { ok: true };
  }

  @Post(':id/fail')
  @RequirePermission('delivery.record_attempt')
  @HttpCode(200)
  async fail(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(Fail, body);
    const d = await this.load(p, id);
    if (await this.prisma.deliveryAttempt.findUnique({ where: { clientUpdateId: b.clientUpdateId } })) return { ok: true, replayed: true };
    await this.prisma.$transaction(async (tx) => {
      await OrdersAdminController.recordAttempt(tx, id, b.reason, b.note, b.clientUpdateId, p.userId);
      await tx.delivery.update({ where: { id }, data: { status: 'FAILED' } });
      await this.orders.transitionInTx(tx, { orderId: d.orderId, to: 'DELIVERY_FAILED', actor: 'RIDER', actorUserId: p.userId, actorRole: 'DELIVERY_STAFF', reason: `${b.reason}: ${b.note}`, outletScope: [d.outletId] }, req);
    });
    return { ok: true };
  }
}
