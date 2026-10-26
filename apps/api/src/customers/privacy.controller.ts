import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from '../auth/session.service.js';
import { CurrentPrincipal, CustomerOnly, RequirePermission } from '../access/decorators.js';
import type { Principal, StaffPrincipal } from '../access/principal.js';

const DeleteIn = z.object({ note: z.string().trim().max(500).optional() }).strict();
const ProcessIn = z.object({ decision: z.enum(['COMPLETE', 'REJECT']), note: z.string().trim().max(500).optional() }).strict();
const OPEN_ORDER_STATUSES = ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'] as const;

/**
 * Customer privacy controls (PRD FR, OPEN_DECISIONS F6).
 * - Export: the customer downloads their own data as JSON, immediately.
 * - Deletion: the customer asks; a Super Admin completes it. Completing
 *   anonymises the account and the personal fields of past orders while keeping
 *   the financial record (amounts, items, payments) for accounting.
 * Retention periods still need legal confirmation (F6).
 */
@Controller()
export class PrivacyController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Get('me/privacy/export')
  @CustomerOnly()
  async export(@CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: Response) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: p.userId },
      select: { id: true, phone: true, email: true, fullName: true, createdAt: true, lastLoginAt: true, addresses: { omit: { userId: true } } },
    });
    const orders = await this.prisma.order.findMany({
      where: { userId: p.userId },
      orderBy: { createdAt: 'desc' },
      select: {
        orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, createdAt: true, slotStartsAt: true, slotEndsAt: true,
        shipName: true, shipPhone: true, shipLine1: true, shipLine2: true, shipLandmark: true, shipInstructions: true, shipAreaNameBn: true,
        subtotalPoisha: true, discountPoisha: true, deliveryFeePoisha: true, totalPoisha: true, couponCode: true,
        items: { select: { productNameBn: true, variantLabelBn: true, sku: true, unitPricePoisha: true, quantity: true, lineTotalPoisha: true } },
      },
    });
    await this.audit.record({ action: 'privacy.export', entityType: 'user', entityId: p.userId }, { userId: p.userId, actorRole: 'CUSTOMER' });
    res.setHeader('content-disposition', `attachment; filename="dudhwala-data-${this.clock.now().toISOString().slice(0, 10)}.json"`);
    return { exportedAt: this.clock.now(), account: user, orders };
  }

  @Get('me/privacy')
  @CustomerOnly()
  async status(@CurrentPrincipal() p: Principal) {
    const r = await this.prisma.privacyRequest.findFirst({ where: { userId: p.userId }, orderBy: { createdAt: 'desc' } });
    return { deleteRequest: r ? { status: r.status, createdAt: r.createdAt, processedAt: r.processedAt } : null };
  }

  @Post('me/privacy/delete-request')
  @CustomerOnly()
  @HttpCode(201)
  async requestDeletion(@CurrentPrincipal() p: Principal, @Body() body: unknown, @Req() req: Request) {
    const { note } = parse(DeleteIn, body);
    if (await this.prisma.privacyRequest.findFirst({ where: { userId: p.userId, status: 'REQUESTED' } })) throw new AppError('CONFLICT', 'আপনার একটি অনুরোধ ইতিমধ্যে প্রক্রিয়াধীন');
    const id = newId();
    await this.prisma.privacyRequest.create({ data: { id, userId: p.userId, kind: 'DELETE', note: note ?? null, createdAt: this.clock.now() } });
    await this.audit.record({ action: 'privacy.delete_request', entityType: 'privacy_request', entityId: id }, { userId: p.userId, actorRole: 'CUSTOMER' }, req);
    return { id, status: 'REQUESTED' };
  }

  @Get('admin/privacy-requests')
  @RequirePermission('customers.privacy')
  async list(@Query('status') status?: string) {
    const st = status === 'COMPLETED' || status === 'REJECTED' ? status : 'REQUESTED';
    const rows = await this.prisma.privacyRequest.findMany({ where: { status: st }, orderBy: { createdAt: 'asc' }, take: 100, include: { user: { select: { phone: true, fullName: true } } } });
    const ids = rows.map((r) => r.userId);
    const open = await this.prisma.order.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: { in: [...OPEN_ORDER_STATUSES] } }, _count: true });
    const openBy = new Map(open.map((o) => [o.userId, o._count]));
    return rows.map((r) => ({ ...r, openOrders: openBy.get(r.userId) ?? 0 }));
  }

  @Post('admin/privacy-requests/:id/process')
  @RequirePermission('customers.privacy')
  @HttpCode(200)
  async process(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ProcessIn, body);
    const r = await this.prisma.privacyRequest.findUnique({ where: { id } });
    if (!r) throw notFound('Request');
    if (r.status !== 'REQUESTED') throw new AppError('CONFLICT', `Request is already ${r.status}`);
    const now = this.clock.now();
    if (b.decision === 'REJECT') {
      await this.prisma.privacyRequest.update({ where: { id }, data: { status: 'REJECTED', note: b.note ?? r.note, processedById: p.userId, processedAt: now } });
      await this.audit.record({ action: 'privacy.delete_reject', entityType: 'privacy_request', entityId: id, after: { note: b.note ?? null } }, { principal: p }, req);
      return { status: 'REJECTED' };
    }
    const openOrders = await this.prisma.order.count({ where: { userId: r.userId, status: { in: [...OPEN_ORDER_STATUSES] } } });
    if (openOrders > 0) throw new AppError('CONFLICT', `Customer has ${openOrders} open order(s); finish or cancel them first`);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: r.userId } });
    await this.prisma.$transaction(async (tx) => {
      const orderIds = (await tx.order.findMany({ where: { userId: r.userId }, select: { id: true } })).map((o) => o.id);
      await tx.order.updateMany({
        where: { userId: r.userId },
        data: { shipName: 'মুছে ফেলা হয়েছে', shipPhone: '00000000000', shipLine1: 'মুছে ফেলা হয়েছে', shipLine2: null, shipLandmark: null, shipInstructions: null },
      });
      await tx.notificationRecord.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.address.deleteMany({ where: { userId: r.userId } });
      await tx.cart.deleteMany({ where: { userId: r.userId } });
      if (user.phone) await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });
      await this.sessions.revokeAllForUser(r.userId, tx);
      await tx.user.update({ where: { id: r.userId }, data: { phone: null, email: `deleted-${r.userId}@deleted.invalid`, fullName: null, status: 'DELETED' } });
      await tx.privacyRequest.update({ where: { id }, data: { status: 'COMPLETED', processedById: p.userId, processedAt: now } });
      await this.audit.record({ action: 'privacy.delete_complete', entityType: 'user', entityId: r.userId, after: { orders: orderIds.length } }, { principal: p }, req, tx);
    });
    return { status: 'COMPLETED' };
  }
}
