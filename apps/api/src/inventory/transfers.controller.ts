import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { outletScope, type StaffPrincipal } from '../access/principal.js';
import { InventoryService } from './inventory.service.js';

const qty = z.number().int().positive().max(100_000);
const RequestIn = z
  .object({
    fromOutletId: z.string().uuid(),
    toOutletId: z.string().uuid(),
    lines: z.array(z.object({ variantId: z.string().uuid(), qty }).strict()).min(1).max(200),
  })
  .strict()
  .refine((v) => v.fromOutletId !== v.toOutletId, 'source and destination must differ')
  .refine((v) => new Set(v.lines.map((l) => l.variantId)).size === v.lines.length, 'each item once');
const ReceiveIn = z.object({ lines: z.array(z.object({ variantId: z.string().uuid(), receivedQty: z.number().int().min(0).max(100_000) }).strict()).min(1).max(200), note: z.string().max(300).optional() }).strict();

type Transfer = { id: string; fromOutletId: string; toOutletId: string; status: string; requestedById: string };

/**
 * Inter-outlet stock transfers (OPEN_DECISIONS C4), off until the
 * `inventory.transfers.enabled` setting is on.
 * REQUESTED → (Super Admin) APPROVED → (source) IN_TRANSIT with TRANSFER_OUT
 * → (destination) RECEIVED with TRANSFER_IN of the quantity actually received.
 * A shortfall stays recorded on the line and in the audit log.
 */
@Controller('admin/transfers')
export class TransfersController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  private async enabled(): Promise<void> {
    if (!(await this.settings.get('inventory.transfers.enabled'))) throw new AppError('FORBIDDEN', 'Stock transfers are turned off (Settings → inventory.transfers.enabled)');
  }

  private inScope(p: StaffPrincipal, outletId: string): boolean {
    const s = outletScope(p);
    return s === 'ALL' || s[0] === outletId;
  }

  /** Loads a transfer the caller may see (source or destination in scope); otherwise 404. */
  private async load(p: StaffPrincipal, id: string): Promise<Transfer & { lines: { productVariantId: string; qty: number; receivedQty: number | null }[] }> {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { lines: true } });
    if (!t || !(this.inScope(p, t.fromOutletId) || this.inScope(p, t.toOutletId))) throw notFound('Transfer');
    return t;
  }

  @Get()
  @RequirePermission('inventory.read')
  list(@CurrentPrincipal() p: StaffPrincipal) {
    const s = outletScope(p);
    return this.prisma.stockTransfer.findMany({
      where: s === 'ALL' ? {} : { OR: [{ fromOutletId: s[0] }, { toOutletId: s[0] }] },
      include: { lines: { include: { variant: { select: { sku: true, labelBn: true, product: { select: { nameBn: true } } } } } }, fromOutlet: { select: { code: true } }, toOutlet: { select: { code: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** Outlets a transfer can name (code and name only), for the request form. */
  @Get('outlets')
  @RequirePermission('inventory.transfer_request')
  async outlets() {
    await this.enabled();
    return this.prisma.outlet.findMany({ where: { status: { not: 'CLOSED' } }, select: { id: true, code: true, nameBn: true }, orderBy: { code: 'asc' } });
  }

  @Post()
  @RequirePermission('inventory.transfer_request')
  async request(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    await this.enabled();
    const b = parse(RequestIn, body);
    if (!this.inScope(p, b.fromOutletId) && !this.inScope(p, b.toOutletId)) throw notFound('Outlet');
    const outlets = await this.prisma.outlet.count({ where: { id: { in: [b.fromOutletId, b.toOutletId] } } });
    if (outlets !== 2) throw notFound('Outlet');
    return this.prisma.$transaction(async (tx) => {
      const id = newId();
      await tx.stockTransfer.create({
        data: { id, fromOutletId: b.fromOutletId, toOutletId: b.toOutletId, status: 'REQUESTED', requestedById: p.userId, lines: { create: b.lines.map((l) => ({ productVariantId: l.variantId, qty: l.qty })) } },
      });
      await this.audit.record({ action: 'inventory.transfer_request', entityType: 'stock_transfer', entityId: id, outletId: b.fromOutletId, after: b }, { principal: p }, req, tx);
      return { id, status: 'REQUESTED' };
    });
  }

  @Post(':id/approve')
  @RequirePermission('inventory.transfer_approve')
  @HttpCode(200)
  async approve(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.enabled();
    const t = await this.load(p, id);
    return this.move(t, 'REQUESTED', 'APPROVED', { approvedById: p.userId }, 'inventory.transfer_approve', p, req);
  }

  /** Source outlet sends the goods: stock leaves the source now. */
  @Post(':id/dispatch')
  @RequirePermission('inventory.adjust')
  @HttpCode(200)
  async dispatch(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    await this.enabled();
    const t = await this.load(p, id);
    if (!this.inScope(p, t.fromOutletId)) throw new AppError('FORBIDDEN', 'Only the source outlet can dispatch');
    return this.inventory.run(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'IN_TRANSIT' } });
      if (claimed.count === 0) throw new AppError('INVALID_TRANSITION', `Transfer is ${t.status}, not APPROVED`);
      for (const l of [...t.lines].sort((a, b) => a.productVariantId.localeCompare(b.productVariantId))) {
        await this.inventory.apply(tx, { outletId: t.fromOutletId, variantId: l.productVariantId, type: 'TRANSFER_OUT', qty: l.qty, transferId: id }, { userId: p.userId });
      }
      await this.audit.record({ action: 'inventory.transfer_dispatch', entityType: 'stock_transfer', entityId: id, outletId: t.fromOutletId }, { principal: p }, req, tx);
      return { id, status: 'IN_TRANSIT' };
    });
  }

  /** Destination records what actually arrived. */
  @Post(':id/receive')
  @RequirePermission('inventory.transfer_receive')
  @HttpCode(200)
  async receive(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    await this.enabled();
    const b = parse(ReceiveIn, body);
    const t = await this.load(p, id);
    if (!this.inScope(p, t.toOutletId)) throw new AppError('FORBIDDEN', 'Only the destination outlet can receive');
    const byVariant = new Map(b.lines.map((l) => [l.variantId, l.receivedQty]));
    for (const l of t.lines) {
      const r = byVariant.get(l.productVariantId);
      if (r === undefined) throw new AppError('VALIDATION_FAILED', `Received quantity missing for ${l.productVariantId}`);
      if (r > l.qty) throw new AppError('VALIDATION_FAILED', 'Received quantity cannot exceed the quantity sent');
    }
    return this.inventory.run(async (tx) => {
      const claimed = await tx.stockTransfer.updateMany({ where: { id, status: 'IN_TRANSIT' }, data: { status: 'RECEIVED' } });
      if (claimed.count === 0) throw new AppError('INVALID_TRANSITION', `Transfer is ${t.status}, not IN_TRANSIT`);
      const shortfalls: { variantId: string; sent: number; received: number }[] = [];
      for (const l of [...t.lines].sort((a, b) => a.productVariantId.localeCompare(b.productVariantId))) {
        const received = byVariant.get(l.productVariantId) as number;
        await tx.stockTransferLine.update({ where: { transferId_productVariantId: { transferId: id, productVariantId: l.productVariantId } }, data: { receivedQty: received } });
        if (received > 0) await this.inventory.apply(tx, { outletId: t.toOutletId, variantId: l.productVariantId, type: 'TRANSFER_IN', qty: received, transferId: id }, { userId: p.userId });
        if (received < l.qty) shortfalls.push({ variantId: l.productVariantId, sent: l.qty, received });
      }
      await this.audit.record({ action: 'inventory.transfer_receive', entityType: 'stock_transfer', entityId: id, outletId: t.toOutletId, after: { shortfalls, note: b.note ?? null } }, { principal: p }, req, tx);
      return { id, status: 'RECEIVED', shortfalls };
    });
  }

  /** Cancel before dispatch: the requester or a Super Admin. Nothing has moved yet. */
  @Post(':id/cancel')
  @RequirePermission('inventory.transfer_request')
  @HttpCode(200)
  async cancel(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const t = await this.load(p, id);
    if (p.staff.role !== 'SUPER_ADMIN' && t.requestedById !== p.userId) throw new AppError('FORBIDDEN', 'Only the requester or a Super Admin can cancel');
    const claimed = await this.prisma.stockTransfer.updateMany({ where: { id, status: { in: ['REQUESTED', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    if (claimed.count === 0) throw new AppError('INVALID_TRANSITION', 'Only transfers that have not been dispatched can be cancelled');
    await this.audit.record({ action: 'inventory.transfer_cancel', entityType: 'stock_transfer', entityId: id, outletId: t.fromOutletId }, { principal: p }, req);
    return { id, status: 'CANCELLED' };
  }

  private async move(t: Transfer, from: 'REQUESTED', to: 'APPROVED', data: { approvedById: string }, action: string, p: StaffPrincipal, req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const n = await tx.stockTransfer.updateMany({ where: { id: t.id, status: from }, data: { status: to, ...data } });
      if (n.count === 0) throw new AppError('INVALID_TRANSITION', `Transfer is ${t.status}, not ${from}`);
      await this.audit.record({ action, entityType: 'stock_transfer', entityId: t.id, outletId: t.fromOutletId }, { principal: p }, req, tx);
      return { id: t.id, status: to };
    });
  }
}
