import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { parseTaka } from '@dudhwala/shared';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { MediaService } from '../media/media.js';
import { toCsv } from '../finance/finance.controller.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase letters, digits and hyphens').max(120);
const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.number().int().positive().max(100_000_000); // poisha; ≤ ৳10,00,000

const CreateCategory = z.object({ slug, nameBn: text(80), nameEn: optText(80), parentId: z.string().uuid().nullable().optional(), sortOrder: z.number().int().optional() }).strict();
const UpdateCategory = CreateCategory.partial().extend({ active: z.boolean().optional() }).strict();

/** Optional content fields are shown to customers only when present (PRD FR-2). */
const contentFields = {
  descriptionBn: optText(4000), descriptionEn: optText(4000),
  ingredientsBn: optText(2000), ingredientsEn: optText(2000),
  allergensBn: optText(1000), allergensEn: optText(1000),
  storageBn: optText(1000), storageEn: optText(1000),
  shelfLifeBn: optText(500), shelfLifeEn: optText(500),
};
const CreateProduct = z.object({ categoryId: z.string().uuid(), slug, nameBn: text(160), nameEn: optText(160), ...contentFields }).strict();
const UpdateProduct = CreateProduct.partial().strict();

const CreateVariant = z
  .object({
    sku: z.string().regex(/^[A-Z0-9-]{2,40}$/),
    labelBn: text(60),
    labelEn: optText(60),
    packSize: z.number().positive().max(100_000),
    packUnit: z.enum(['ML', 'L', 'G', 'KG', 'PCS']),
    pricePoisha: money,
    compareAtPoisha: money.nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict()
  .refine((v) => v.compareAtPoisha == null || v.compareAtPoisha > v.pricePoisha, 'compare-at price must be higher than price');
const UpdateVariant = z
  .object({
    labelBn: text(60).optional(),
    labelEn: optText(60),
    pricePoisha: money.optional(),
    compareAtPoisha: money.nullable().optional(),
    status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();

const MAX_BULK_ROWS = 500;
const BulkPrice = z
  .object({
    dryRun: z.boolean(),
    rows: z.array(z.object({ sku: z.string().trim().max(40), priceTaka: z.string().trim().max(20), compareAtTaka: z.string().trim().max(20).optional() }).strict()).min(1).max(MAX_BULK_ROWS),
  })
  .strict();

export interface BulkPriceRowResult {
  row: number;
  sku: string;
  ok: boolean;
  error?: string;
  beforePoisha?: number;
  afterPoisha?: number;
}

/**
 * Minimal catalogue administration (M3). Global catalogue, single price per
 * variant (OPEN_DECISIONS B2). Nothing is visible to customers until a
 * Super Admin publishes it, recording who approved the content.
 */
@Controller('admin')
export class CatalogAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Get('categories')
  @RequirePermission('catalog.read_admin')
  categories() {
    return this.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] });
  }

  @Post('categories')
  @RequirePermission('catalog.manage')
  async createCategory(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CreateCategory, body);
    await this.assertSlugFree('category', b.slug);
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.category.create({ data: { id: newId(), ...b } });
      await this.audit.record({ action: 'catalog.category_create', entityType: 'category', entityId: c.id, after: { slug: c.slug } }, { principal: p }, req, tx);
      return c;
    });
  }

  @Patch('categories/:id')
  @RequirePermission('catalog.manage')
  async updateCategory(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(UpdateCategory, body);
    if (b.parentId === id) throw new AppError('VALIDATION_FAILED', 'A category cannot be its own parent');
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.category.findUnique({ where: { id } }))) throw notFound('Category');
      const c = await tx.category.update({ where: { id }, data: b });
      await this.audit.record({ action: 'catalog.category_update', entityType: 'category', entityId: id, after: b }, { principal: p }, req, tx);
      return c;
    });
  }

  @Get('products')
  @RequirePermission('catalog.read_admin')
  products() {
    return this.prisma.product.findMany({ include: { variants: { orderBy: { sortOrder: 'asc' } }, category: { select: { slug: true, nameBn: true } } }, orderBy: { createdAt: 'desc' } });
  }

  /** Variant price list for spreadsheet editing; round-trips through POST variants/bulk-price. */
  @Get('variants/export.csv')
  @RequirePermission('catalog.read_admin')
  async exportVariants(@CurrentPrincipal() p: StaffPrincipal, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const variants = await this.prisma.productVariant.findMany({ include: { product: { select: { slug: true, nameBn: true, status: true } } }, orderBy: [{ product: { slug: 'asc' } }, { sortOrder: 'asc' }] });
    const rows = variants.map((v) => ({
      sku: v.sku,
      product: v.product.slug,
      name: v.product.nameBn,
      label: v.labelBn,
      status: v.status,
      priceTaka: (v.pricePoisha / 100).toFixed(2),
      compareAtTaka: v.compareAtPoisha == null ? '' : (v.compareAtPoisha / 100).toFixed(2),
    }));
    await this.audit.record({ action: 'catalog.export_csv', entityType: 'product_variant', entityId: 'all', after: { rows: rows.length } }, { principal: p }, req);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', 'attachment; filename="dudhwala-variants.csv"');
    return '\uFEFF' + (toCsv(rows) || 'sku,product,name,label,status,priceTaka,compareAtTaka\n'); // BOM so Excel shows Bangla correctly
  }

  /**
   * Bulk price edit by SKU. All-or-nothing: every row is validated first; one bad row (unknown SKU,
   * bad amount, duplicate SKU, compare-at not above price) rejects the whole file and nothing is saved.
   * `dryRun` returns the same per-row report without writing, for the preview step.
   */
  @Post('variants/bulk-price')
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  async bulkPrice(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(BulkPrice, body);
    if (!(await this.hasPermission(p, 'pricing.manage_global'))) throw new AppError('FORBIDDEN', 'Permission denied');
    const skus = b.rows.map((r) => r.sku.toUpperCase());
    const found = await this.prisma.productVariant.findMany({ where: { sku: { in: skus } } });
    const bySku = new Map(found.map((v) => [v.sku, v]));
    const seen = new Set<string>();
    const results: BulkPriceRowResult[] = [];
    const changes: { id: string; sku: string; price: number; compare: number | null; before: number; beforeCompare: number | null }[] = [];
    b.rows.forEach((r, i) => {
      const sku = r.sku.toUpperCase();
      const res: BulkPriceRowResult = { row: i + 1, sku, ok: false };
      const fail = (error: string) => results.push({ ...res, error });
      if (seen.has(sku)) return fail('duplicate SKU in file');
      seen.add(sku);
      const v = bySku.get(sku);
      if (!v) return fail('unknown SKU');
      let price: number;
      let compare: number | null = null;
      try {
        price = parseTaka(r.priceTaka);
        if (r.compareAtTaka) compare = parseTaka(r.compareAtTaka);
      } catch {
        return fail('invalid amount');
      }
      if (price <= 0 || price > 100_000_000) return fail('price out of range');
      if (compare !== null && compare <= price) return fail('compare-at price must be higher than price');
      results.push({ ...res, ok: true, beforePoisha: v.pricePoisha, afterPoisha: price });
      changes.push({ id: v.id, sku, price, compare, before: v.pricePoisha, beforeCompare: v.compareAtPoisha });
    });
    const invalid = results.filter((r) => !r.ok).length;
    const applied = !b.dryRun && invalid === 0;
    if (applied) {
      await this.prisma.$transaction(async (tx) => {
        for (const c of changes) {
          if (c.price === c.before && c.compare === c.beforeCompare) continue;
          await tx.productVariant.update({ where: { id: c.id }, data: { pricePoisha: c.price, compareAtPoisha: c.compare } });
          await this.audit.record(
            { action: 'catalog.price_change', entityType: 'product_variant', entityId: c.id, before: { pricePoisha: c.before }, after: { pricePoisha: c.price, via: 'bulk_csv' } },
            { principal: p },
            req,
            tx,
          );
        }
      });
    }
    return { applied, dryRun: b.dryRun, total: results.length, invalid, unchanged: changes.filter((c) => c.price === c.before && c.compare === c.beforeCompare).length, rows: results };
  }

  @Get('products/:id')
  @RequirePermission('catalog.read_admin')
  async product(@Param('id', ParseUUIDPipe) id: string) {
    const prod = await this.prisma.product.findUnique({ where: { id }, include: { variants: { orderBy: { sortOrder: 'asc' } }, images: { orderBy: { sortOrder: 'asc' } } } });
    if (!prod) throw notFound('Product');
    return { ...prod, images: prod.images.map((i) => ({ ...i, url: this.media.url(i.storageKey) })) };
  }

  @Post('products')
  @RequirePermission('catalog.manage')
  async createProduct(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CreateProduct, body);
    if (!(await this.prisma.category.findUnique({ where: { id: b.categoryId } }))) throw notFound('Category');
    await this.assertSlugFree('product', b.slug);
    return this.prisma.$transaction(async (tx) => {
      const prod = await tx.product.create({ data: { id: newId(), ...b, status: 'DRAFT' } });
      await this.audit.record({ action: 'catalog.product_create', entityType: 'product', entityId: prod.id, after: { slug: prod.slug } }, { principal: p }, req, tx);
      return prod;
    });
  }

  /** Editing a published product's content withdraws its approval until re-published. */
  @Patch('products/:id')
  @RequirePermission('catalog.manage')
  async updateProduct(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(UpdateProduct, body);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw notFound('Product');
      if (b.slug && b.slug !== before.slug) await this.assertSlugFree('product', b.slug);
      const contentChanged = Object.keys(b).some((k) => k !== 'categoryId');
      const prod = await tx.product.update({
        where: { id },
        data: { ...b, ...(contentChanged && before.status === 'ACTIVE' ? { status: 'DRAFT', contentApprovedBy: null, contentApprovedAt: null } : {}) },
      });
      await this.audit.record({ action: 'catalog.product_update', entityType: 'product', entityId: id, after: b }, { principal: p }, req, tx);
      return prod;
    });
  }

  @Post('products/:id/variants')
  @RequirePermission('catalog.manage')
  async createVariant(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) productId: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CreateVariant, body);
    if (!(await this.prisma.product.findUnique({ where: { id: productId } }))) throw notFound('Product');
    if (await this.prisma.productVariant.findUnique({ where: { sku: b.sku } })) throw new AppError('CONFLICT', 'SKU already exists');
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.create({ data: { id: newId(), productId, ...b, status: 'DRAFT' } });
      await this.audit.record({ action: 'catalog.variant_create', entityType: 'product_variant', entityId: v.id, after: { sku: v.sku, pricePoisha: v.pricePoisha } }, { principal: p }, req, tx);
      return v;
    });
  }

  /** Price changes affect only future orders; order items keep their snapshot (FR-10). */
  @Patch('variants/:id')
  @RequirePermission('catalog.manage')
  async updateVariant(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(UpdateVariant, body);
    if (b.pricePoisha !== undefined && !(await this.hasPermission(p, 'pricing.manage_global'))) throw new AppError('FORBIDDEN', 'Permission denied');
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.productVariant.findUnique({ where: { id } });
      if (!before) throw notFound('Variant');
      const price = b.pricePoisha ?? before.pricePoisha;
      const compare = b.compareAtPoisha === undefined ? before.compareAtPoisha : b.compareAtPoisha;
      if (compare != null && compare <= price) throw new AppError('VALIDATION_FAILED', 'compare-at price must be higher than price');
      const v = await tx.productVariant.update({ where: { id }, data: b });
      await this.audit.record(
        { action: b.pricePoisha !== undefined ? 'catalog.price_change' : 'catalog.variant_update', entityType: 'product_variant', entityId: id, before: { pricePoisha: before.pricePoisha, status: before.status }, after: b },
        { principal: p },
        req,
        tx,
      );
      return v;
    });
  }

  @Post('products/:id/publish')
  @RequirePermission('catalog.publish')
  @HttpCode(200)
  async publish(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const prod = await tx.product.findUnique({ where: { id }, include: { variants: true } });
      if (!prod) throw notFound('Product');
      const sellable = prod.variants.filter((v) => v.status !== 'ARCHIVED');
      if (sellable.length === 0) throw new AppError('VALIDATION_FAILED', 'Add at least one variant before publishing');
      const now = this.clock.now();
      await tx.productVariant.updateMany({ where: { productId: id, status: 'DRAFT' }, data: { status: 'ACTIVE' } });
      const updated = await tx.product.update({ where: { id }, data: { status: 'ACTIVE', contentApprovedBy: p.userId, contentApprovedAt: now } });
      await this.audit.record({ action: 'catalog.publish', entityType: 'product', entityId: id }, { principal: p }, req, tx);
      return updated;
    });
  }

  @Post('products/:id/archive')
  @RequirePermission('catalog.manage')
  @HttpCode(200)
  async archive(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.product.findUnique({ where: { id } }))) throw notFound('Product');
      const updated = await tx.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.audit.record({ action: 'catalog.archive', entityType: 'product', entityId: id }, { principal: p }, req, tx);
      return updated;
    });
  }

  private async assertSlugFree(kind: 'category' | 'product', s: string): Promise<void> {
    const exists = kind === 'category' ? await this.prisma.category.findUnique({ where: { slug: s } }) : await this.prisma.product.findUnique({ where: { slug: s } });
    if (exists) throw new AppError('CONFLICT', `${kind} slug already exists`);
  }

  private async hasPermission(p: StaffPrincipal, perm: 'pricing.manage_global'): Promise<boolean> {
    return p.staff.permissions.has(perm);
  }
}
