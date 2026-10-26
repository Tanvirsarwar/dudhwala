import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
