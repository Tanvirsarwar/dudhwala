import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { availableOnline } from '@dudhwala/shared';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, type StaffPrincipal } from '../access/principal.js';
import { InventoryService } from './inventory.service.js';

const qty = z.number().int().positive().max(100_000);
const Receive = z.object({ variantId: z.string().uuid(), qty, note: z.string().max(300).optional() }).strict();
const Adjust = z
  .object({ variantId: z.string().uuid(), deltaQty: z.number().int().min(-100_000).max(100_000).refine((v) => v !== 0, 'must not be 0'), reason: z.string().min(3).max(300) })
  .strict();
const WriteOff = z.object({ variantId: z.string().uuid(), qty, reason: z.string().min(3).max(300) }).strict();
const Settings = z
  .object({
    lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
    onlineBufferQty: z.number().int().min(0).max(100_000).optional(),
    isListed: z.boolean().optional(),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
const MovementQuery = z
  .object({ variantId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) })
  .strict();

@Controller('admin/outlets/:outletId/inventory')
export class InventoryController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission('inventory.read')
  async list(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    const rows = await this.prisma.inventory.findMany({
      where: { outletId },
      include: { variant: { select: { sku: true, labelBn: true, product: { select: { nameBn: true } } } } },
      orderBy: { variant: { sku: 'asc' } },
    });
    return rows.map((r) => ({
      variantId: r.productVariantId,
      sku: r.variant.sku,
      name: `${r.variant.product.nameBn} — ${r.variant.labelBn}`,
      onHand: r.quantityOnHand,
      reserved: r.reservedQuantity,
      onlineBuffer: r.onlineBufferQty,
      availableOnline: availableOnline({ onHand: r.quantityOnHand, reserved: r.reservedQuantity, onlineBuffer: r.onlineBufferQty }),
      lowStockThreshold: r.lowStockThreshold,
      lowStock: r.quantityOnHand - r.reservedQuantity <= r.lowStockThreshold,
      isListed: r.isListed,
      version: r.version,
    }));
  }

  @Post('receive')
  @RequirePermission('inventory.receive')
  async receive(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(Receive, body);
    await this.assertVariant(b.variantId);
    return this.inventory.run(async (tx) => {
      const r = await this.inventory.apply(tx, { outletId, variantId: b.variantId, type: 'RECEIVE', qty: b.qty, reason: b.note ?? null }, { userId: p.userId });
      await this.audit.record({ action: 'inventory.receive', entityType: 'inventory', entityId: b.variantId, outletId, after: { qty: b.qty, ...r } }, { principal: p }, req, tx);
      return r;
    });
  }

  @Post('adjust')
  @RequirePermission('inventory.adjust')
  async adjust(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(Adjust, body);
    return this.inventory.run(async (tx) => {
      const type = b.deltaQty > 0 ? 'ADJUST_UP' : 'ADJUST_DOWN';
      const r = await this.inventory.apply(tx, { outletId, variantId: b.variantId, type, qty: Math.abs(b.deltaQty), reason: b.reason }, { userId: p.userId });
      await this.audit.record({ action: 'inventory.adjust', entityType: 'inventory', entityId: b.variantId, outletId, after: { deltaQty: b.deltaQty, reason: b.reason, ...r } }, { principal: p }, req, tx);
      return r;
    });
  }

  @Post('write-off')
  @RequirePermission('inventory.write_off')
  async writeOff(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(WriteOff, body);
    return this.inventory.run(async (tx) => {
      const r = await this.inventory.apply(tx, { outletId, variantId: b.variantId, type: 'WRITE_OFF', qty: b.qty, reason: b.reason }, { userId: p.userId });
      await this.audit.record({ action: 'inventory.write_off', entityType: 'inventory', entityId: b.variantId, outletId, after: { qty: b.qty, reason: b.reason, ...r } }, { principal: p }, req, tx);
      return r;
    });
  }

  @Patch(':variantId')
  @RequirePermission('inventory.thresholds')
  async settings(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    const { expectedVersion, ...data } = parse(Settings, body);
    return this.inventory.run(async (tx) => {
      const updated = await tx.inventory.updateMany({
        where: { outletId, productVariantId: variantId, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        const exists = await tx.inventory.findUnique({ where: { outletId_productVariantId: { outletId, productVariantId: variantId } } });
        if (!exists) throw notFound('Inventory item');
        throw new AppError('VERSION_CONFLICT', 'Inventory changed since you loaded it; reload and try again', { version: exists.version });
      }
      await this.audit.record({ action: 'inventory.settings', entityType: 'inventory', entityId: variantId, outletId, after: data }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  @Get('movements')
  @RequirePermission('inventory.read')
  movements(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Query() query: unknown) {
    assertOutletInScope(p, outletId);
    const q = parse(MovementQuery, query);
    return this.prisma.stockMovement.findMany({
      where: { outletId, ...(q.variantId ? { productVariantId: q.variantId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  }

  private async assertVariant(variantId: string): Promise<void> {
    const v = await this.prisma.productVariant.findUnique({ where: { id: variantId } });
    if (!v) throw notFound('Product variant');
  }
}
