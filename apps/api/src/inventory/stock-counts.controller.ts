import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, type StaffPrincipal } from '../access/principal.js';
import { InventoryService } from './inventory.service.js';

const Lines = z.object({ lines: z.array(z.object({ variantId: z.string().uuid(), countedQty: z.number().int().min(0).max(1_000_000) }).strict()).min(1).max(1000) }).strict();

/**
 * Physical stock count / reconciliation (APP_FLOW §2.2). Start snapshots the
 * system quantity of every inventory row; staff enter counted quantities;
 * completing posts one RECONCILE movement per difference. The adjustment is
 * the difference found at count time (counted − snapshot), applied to the
 * current quantity, so sales that happen during the count are not undone.
 */
@Controller('admin/outlets/:outletId/stock-counts')
export class StockCountsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  @Get()
  @RequirePermission('inventory.read')
  list(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return this.prisma.stockCount.findMany({ where: { outletId }, orderBy: { createdAt: 'desc' }, take: 50, include: { _count: { select: { lines: true } } } });
  }

  @Get(':countId')
  @RequirePermission('inventory.read')
  async get(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Param('countId', ParseUUIDPipe) countId: string) {
    assertOutletInScope(p, outletId);
    const c = await this.prisma.stockCount.findFirst({
      where: { id: countId, outletId },
      include: { lines: { include: { variant: { select: { sku: true, labelBn: true, product: { select: { nameBn: true } } } } }, orderBy: { variant: { sku: 'asc' } } } },
    });
    if (!c) throw notFound('Stock count');
    return {
      ...c,
      lines: c.lines.map((l) => ({
        variantId: l.productVariantId,
        sku: l.variant.sku,
        name: `${l.variant.product.nameBn} — ${l.variant.labelBn}`,
        systemQty: l.systemQty,
        countedQty: l.countedQty,
        difference: l.countedQty == null ? null : l.countedQty - l.systemQty,
      })),
    };
  }

  @Post()
  @RequirePermission('inventory.count')
  async start(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    return this.prisma.$transaction(async (tx) => {
      if (await tx.stockCount.findFirst({ where: { outletId, status: 'OPEN' } })) throw new AppError('CONFLICT', 'A stock count is already open for this outlet');
      const rows = await tx.inventory.findMany({ where: { outletId } });
      if (rows.length === 0) throw new AppError('VALIDATION_FAILED', 'This outlet has no inventory to count');
      const id = newId();
      await tx.stockCount.create({ data: { id, outletId, startedById: p.userId, createdAt: this.clock.now() } });
      await tx.stockCountLine.createMany({ data: rows.map((r) => ({ countId: id, productVariantId: r.productVariantId, systemQty: r.quantityOnHand })) });
      await this.audit.record({ action: 'inventory.count_start', entityType: 'stock_count', entityId: id, outletId, after: { lines: rows.length } }, { principal: p }, req, tx);
      return { id, lines: rows.length };
    });
  }

  @Put(':countId/lines')
  @RequirePermission('inventory.count')
  async enter(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Param('countId', ParseUUIDPipe) countId: string, @Body() body: unknown) {
    assertOutletInScope(p, outletId);
    const { lines } = parse(Lines, body);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.stockCount.findFirst({ where: { id: countId, outletId } });
      if (!c) throw notFound('Stock count');
      if (c.status !== 'OPEN') throw new AppError('CONFLICT', 'This stock count is closed');
      for (const l of lines) {
        const n = await tx.stockCountLine.updateMany({ where: { countId, productVariantId: l.variantId }, data: { countedQty: l.countedQty } });
        if (n.count === 0) throw new AppError('VALIDATION_FAILED', `Item ${l.variantId} is not part of this count`);
      }
      return { updated: lines.length };
    });
  }

  /** Managers (and Super Admin) complete a count; outlet staff may only enter quantities. */
  @Post(':countId/complete')
  @RequirePermission('inventory.count')
  @HttpCode(200)
  async complete(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Param('countId', ParseUUIDPipe) countId: string, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    if (p.staff.role === 'OUTLET_STAFF') throw new AppError('FORBIDDEN', 'Only a manager can complete a stock count');
    return this.inventory.run(async (tx) => {
      const c = await tx.stockCount.findFirst({ where: { id: countId, outletId }, include: { lines: true } });
      if (!c) throw notFound('Stock count');
      if (c.status !== 'OPEN') throw new AppError('CONFLICT', 'This stock count is closed');
      const claimed = await tx.stockCount.updateMany({ where: { id: countId, status: 'OPEN' }, data: { status: 'COMPLETED', completedById: p.userId, completedAt: this.clock.now() } });
      if (claimed.count === 0) throw new AppError('CONFLICT', 'Stock count changed concurrently');
      const adjustments: { variantId: string; delta: number }[] = [];
      for (const l of c.lines.sort((a, b) => a.productVariantId.localeCompare(b.productVariantId))) {
        if (l.countedQty == null) continue; // not counted: left unchanged
        const delta = l.countedQty - l.systemQty;
        if (delta === 0) continue;
        await this.inventory.apply(tx, { outletId, variantId: l.productVariantId, type: 'RECONCILE', qty: delta, reason: `Stock count ${countId}` }, { userId: p.userId });
        adjustments.push({ variantId: l.productVariantId, delta });
      }
      await this.audit.record({ action: 'inventory.count_complete', entityType: 'stock_count', entityId: countId, outletId, after: { adjustments } }, { principal: p }, req, tx);
      return { status: 'COMPLETED', adjustments, uncounted: c.lines.filter((l) => l.countedQty == null).length };
    });
  }

  @Post(':countId/cancel')
  @RequirePermission('inventory.count')
  @HttpCode(200)
  async cancel(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Param('countId', ParseUUIDPipe) countId: string, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const n = await this.prisma.stockCount.updateMany({ where: { id: countId, outletId, status: 'OPEN' }, data: { status: 'CANCELLED', completedById: p.userId, completedAt: this.clock.now() } });
    if (n.count === 0) throw notFound('Open stock count');
    await this.audit.record({ action: 'inventory.count_cancel', entityType: 'stock_count', entityId: countId, outletId }, { principal: p }, req);
    return { status: 'CANCELLED' };
  }
}
