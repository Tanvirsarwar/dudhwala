import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CurrentPrincipal, StaffRead, StaffWrite } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { newId } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { MediaService } from '../media/media.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CatalogService, outerFromApi } from './catalog.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const Text = (max: number) => z.string().trim().min(1).max(max);
const OptText = (max: number) => z.string().trim().max(max).nullable().optional();
const Poisha = z.number().int().min(1).max(1_000_000_00).nullable().optional();

const CategoryCreate = z.object({ nameBn: Text(60), nameEn: Text(60) }).strict();
const CategoryPatch = z
  .object({ nameBn: Text(60).optional(), nameEn: Text(60).optional(), active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(1000).optional() })
  .strict();

const ProductCreate = z.object({ nameBn: Text(120), nameEn: Text(120), categorySlug: z.string().max(80) }).strict();
const VariantInput = z
  .object({
    id: z.string().uuid().optional(),
    labelBn: z.string().trim().max(60).default(''),
    pricePoisha: Poisha,
    compareAtPoisha: Poisha,
    stock: z.number().int().min(0).max(1_000_000).nullable().optional(),
    maxQty: z.number().int().min(1).max(999).optional(),
  })
  .strict();
const ProductPatch = z
  .object({
    nameBn: Text(120).optional(),
    nameEn: Text(120).optional(),
    categorySlug: z.string().max(80).optional(),
    active: z.boolean().optional(),
    nameVerified: z.boolean().optional(),
    outerCityStatus: z.enum(['approved', 'disabled', 'pending_verification', 'pending_confirmation']).nullable().optional(),
    content: z
      .object({ descriptionBn: OptText(2000), ingredientsBn: OptText(2000), allergensBn: OptText(2000), storageBn: OptText(2000), shelfLifeBn: OptText(2000) })
      .strict()
      .optional(),
    variants: z.array(VariantInput).min(1).max(20).optional(),
  })
  .strict();
const ImageUpload = z.object({ dataBase64: z.string().min(1).max(8 * 1024 * 1024) }).strict();
const StockSet = z.object({ outletId: z.string().uuid(), variantId: z.string().uuid(), quantity: z.number().int().min(0).max(1_000_000) }).strict();
const AdminList = z.object({ q: z.string().trim().max(80).optional(), category: z.string().max(80).optional(), status: z.enum(['active', 'hidden', 'noprice', 'noimage']).optional() }).passthrough();

const INCLUDE = { category: true, variants: true } as const;

@Controller('admin')
export class CatalogAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  // ── categories ──

  @Get('categories')
  @StaffRead()
  async categories() {
    const rows = await this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { products: true } } } });
    return rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));
  }

  @Post('categories')
  @StaffWrite()
  async createCategory(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CategoryCreate, body);
    return this.prisma.$transaction(async (tx) => {
      const max = await tx.category.aggregate({ _max: { sortOrder: true } });
      const c = await tx.category.create({ data: { id: newId(), slug: `c-${randomBytes(3).toString('hex')}`, nameBn: b.nameBn, nameEn: b.nameEn, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
      await this.audit.record({ action: 'category.create', entityType: 'category', entityId: c.id, after: { nameBn: c.nameBn, nameEn: c.nameEn } }, { principal: p }, req, tx);
      return c;
    });
  }

  @Patch('categories/:id')
  @StaffWrite()
  async patchCategory(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CategoryPatch, body);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw notFound('Category');
      const c = await tx.category.update({ where: { id }, data: b });
      await this.audit.record({ action: 'category.update', entityType: 'category', entityId: id, before: { ...before }, after: { ...c } }, { principal: p }, req, tx);
      return c;
    });
  }

  // ── products ──

  @Get('products')
  @StaffRead()
  async products(@Query() query: unknown) {
    const q = parse(AdminList, query);
    const and: Prisma.ProductWhereInput[] = [];
    if (q.category) and.push({ category: { slug: q.category } });
    if (q.status === 'active') and.push({ active: true });
    if (q.status === 'hidden') and.push({ active: false });
    if (q.status === 'noprice') and.push({ variants: { some: { pricePoisha: null } } });
    if (q.status === 'noimage') and.push({ imageKey: null });
    if (q.q) and.push({ OR: [{ nameBn: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] });
    const rows = await this.prisma.product.findMany({ where: { AND: and }, include: INCLUDE, orderBy: { createdAt: 'asc' } });
    const dispatch = await this.settings.get('fulfilment.dispatchOutletId');
    return { data: await Promise.all(rows.map((r) => this.catalog.adminView(this.prisma, r, dispatch))), total: rows.length };
  }

  @Get('products/:id')
  @StaffRead()
  async product(@Param('id', ParseUUIDPipe) id: string) {
    const row = await this.prisma.product.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw notFound('Product');
    return this.catalog.adminView(this.prisma, row, await this.settings.get('fulfilment.dispatchOutletId'));
  }

  @Post('products')
  @StaffWrite()
  async createProduct(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ProductCreate, body);
    const cat = await this.prisma.category.findUnique({ where: { slug: b.categorySlug } });
    if (!cat) throw new AppError('VALIDATION_FAILED', 'Choose a category');
    const dispatch = await this.settings.get('fulfilment.dispatchOutletId');
    return this.prisma.$transaction(async (tx) => {
      const id = newId();
      // New products start hidden: the admin reviews name, price and photo, then switches them on.
      await tx.product.create({
        data: { id, categoryId: cat.id, slug: `p-${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`, nameBn: b.nameBn, nameEn: b.nameEn, nameVerified: true, active: false, variants: { create: [{ id: newId() }] } },
      });
      await this.audit.record({ action: 'product.create', entityType: 'product', entityId: id, after: { nameBn: b.nameBn, nameEn: b.nameEn, category: b.categorySlug } }, { principal: p }, req, tx);
      return this.catalog.adminView(tx, await tx.product.findUniqueOrThrow({ where: { id }, include: INCLUDE }), dispatch);
    });
  }

  @Patch('products/:id')
  @StaffWrite()
  async patchProduct(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ProductPatch, body);
    const dispatch = await this.settings.get('fulfilment.dispatchOutletId');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id }, include: INCLUDE });
      if (!before) throw notFound('Product');
      const data: Prisma.ProductUpdateInput = {};
      if (b.nameBn !== undefined) data.nameBn = b.nameBn;
      if (b.nameEn !== undefined) data.nameEn = b.nameEn;
      if (b.active !== undefined) data.active = b.active;
      if (b.nameVerified !== undefined) data.nameVerified = b.nameVerified;
      if (b.outerCityStatus !== undefined) data.outerCityStatus = outerFromApi(b.outerCityStatus);
      if (b.categorySlug !== undefined) {
        const cat = await tx.category.findUnique({ where: { slug: b.categorySlug } });
        if (!cat) throw new AppError('VALIDATION_FAILED', 'Unknown category');
        data.category = { connect: { id: cat.id } };
      }
      if (b.content) {
        for (const k of ['descriptionBn', 'ingredientsBn', 'allergensBn', 'storageBn', 'shelfLifeBn'] as const) {
          const v = b.content[k];
          if (v !== undefined) data[k] = v === null || v === '' ? null : v;
        }
      }
      if (Object.keys(data).length) await tx.product.update({ where: { id }, data });
      if (b.variants) await this.replaceVariants(tx, before.variants, id, b.variants, dispatch, p);
      const after = await tx.product.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      await this.audit.record(
        { action: 'product.update', entityType: 'product', entityId: id, before: this.snapshot(before), after: this.snapshot(after) },
        { principal: p },
        req,
        tx,
      );
      return this.catalog.adminView(tx, after, dispatch);
    });
  }

  private snapshot(p: Prisma.ProductGetPayload<{ include: typeof INCLUDE }>): Prisma.InputJsonValue {
    return {
      nameBn: p.nameBn,
      nameEn: p.nameEn,
      active: p.active,
      nameVerified: p.nameVerified,
      outerCityStatus: p.outerCityStatus,
      variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, maxQty: v.maxQty, trackStock: v.trackStock })),
    };
  }

  /** Replace-all semantics (contract): ids not listed are removed unless they have stock history or orders. */
  private async replaceVariants(
    tx: Tx,
    existing: { id: string; trackStock: boolean }[],
    productId: string,
    input: z.infer<typeof VariantInput>[],
    dispatchOutletId: string | null,
    p: StaffPrincipal,
  ): Promise<void> {
    const have = new Map(existing.map((v) => [v.id, v]));
    const keep = new Set(input.map((v) => v.id).filter((x): x is string => Boolean(x && have.has(x))));
    for (const v of existing) {
      if (keep.has(v.id)) continue;
      const used = (await tx.stockMovement.count({ where: { productVariantId: v.id } })) + (await tx.orderItem.count({ where: { productVariantId: v.id } }));
      if (used > 0) throw new AppError('CONFLICT', 'This size/option has orders or stock history and cannot be removed. Hide the product or clear its price instead.');
      await tx.productVariant.delete({ where: { id: v.id } });
    }
    for (const [i, v] of input.entries()) {
      if (v.compareAtPoisha != null && (v.pricePoisha == null || v.compareAtPoisha <= v.pricePoisha)) throw new AppError('VALIDATION_FAILED', 'Old price must be higher than the price');
      const id = v.id && have.has(v.id) ? v.id : newId();
      const fields = {
        labelBn: v.labelBn,
        pricePoisha: v.pricePoisha ?? null,
        compareAtPoisha: v.compareAtPoisha ?? null,
        ...(v.maxQty !== undefined ? { maxQty: v.maxQty } : {}),
        sortOrder: i,
        // stock: null => not counted; a number => counted
        ...(v.stock !== undefined ? { trackStock: v.stock !== null } : {}),
      };
      if (have.has(id)) await tx.productVariant.update({ where: { id }, data: fields });
      else await tx.productVariant.create({ data: { id, productId, ...fields } });
      if (v.stock != null) {
        const current = await this.availableAtDispatch(tx, dispatchOutletId, id);
        if (current !== v.stock) {
          if (!dispatchOutletId) throw new AppError('VALIDATION_FAILED', 'Set the home-delivery dispatch outlet before entering stock (setup step, see docs/SETUP_OWNER_DATA.md)');
          const reserved = (await tx.inventory.findUnique({ where: { outletId_productVariantId: { outletId: dispatchOutletId, productVariantId: id } } }))?.reservedQuantity ?? 0;
          await this.inventory.setStock(tx, dispatchOutletId, id, v.stock + reserved, { userId: p.userId }, 'admin edit');
        }
      }
    }
  }

  private async availableAtDispatch(tx: Tx, outletId: string | null, variantId: string): Promise<number> {
    if (!outletId) return 0;
    const r = await tx.inventory.findUnique({ where: { outletId_productVariantId: { outletId, productVariantId: variantId } } });
    return r ? r.quantityOnHand - r.reservedQuantity : 0;
  }

  /** Stock at any outlet (pickup outlets, collection outlet). Sets the counted quantity on hand. */
  @Post('inventory')
  @StaffWrite()
  @HttpCode(200)
  async setInventory(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(StockSet, body);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.outlet.findUnique({ where: { id: b.outletId } }))) throw notFound('Outlet');
      const v = await tx.productVariant.findUnique({ where: { id: b.variantId } });
      if (!v) throw notFound('Variant');
      await tx.productVariant.update({ where: { id: v.id }, data: { trackStock: true } });
      await this.inventory.setStock(tx, b.outletId, b.variantId, b.quantity, { userId: p.userId }, 'admin stock entry');
      await this.audit.record({ action: 'inventory.set', entityType: 'inventory', entityId: b.variantId, after: { outletId: b.outletId, quantity: b.quantity } }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  // ── product image ──

  @Post('products/:id/image')
  @StaffWrite()
  @HttpCode(200)
  async uploadImage(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ImageUpload, body);
    const product = await this.prisma.product.findUnique({ where: { id }, include: INCLUDE });
    if (!product) throw notFound('Product');
    const stored = await this.media.storeImage('products', Buffer.from(b.dataBase64, 'base64'));
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.product.update({
        where: { id },
        data: { imageKey: stored.key, imageWidth: stored.width, imageHeight: stored.height, imageVersion: { increment: 1 } },
        include: INCLUDE,
      });
      await this.audit.record({ action: 'product.image_set', entityType: 'product', entityId: id, before: { imageKey: product.imageKey }, after: { imageKey: stored.key } }, { principal: p }, req, tx);
      return this.catalog.adminView(tx, after, await this.settings.get('fulfilment.dispatchOutletId', tx));
    });
  }

  @Delete('products/:id/image')
  @StaffWrite()
  async removeImage(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw notFound('Product');
      const after = await tx.product.update({ where: { id }, data: { imageKey: null, imageWidth: null, imageHeight: null, imageVersion: { increment: 1 } }, include: INCLUDE });
      await this.audit.record({ action: 'product.image_remove', entityType: 'product', entityId: id, before: { imageKey: before.imageKey } }, { principal: p }, req, tx);
      return this.catalog.adminView(tx, after, await this.settings.get('fulfilment.dispatchOutletId', tx));
    });
  }
}
