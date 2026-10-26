import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { SettingsService } from '../settings/settings.service.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, CustomerOnly, Public, RequirePermission } from '../access/decorators.js';
import type { Principal, StaffPrincipal } from '../access/principal.js';
import { MAX_UPLOAD_BYTES, MediaService } from '../media/media.js';

/** Pages the storefront links to. Content is plain text (no HTML), so it cannot inject script. */
export const PAGE_SLUGS = ['about', 'faq', 'terms', 'privacy', 'refund-policy', 'delivery-policy', 'contact'] as const;

/** Minimal shape of multer's in-memory file (avoids depending on global Express.Multer types). */
interface UploadedImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const PageIn = z
  .object({
    titleBn: z.string().trim().min(1).max(120),
    bodyBn: z.string().trim().min(1).max(20_000),
    titleEn: z.string().trim().max(120).nullable().optional(),
    bodyEn: z.string().trim().max(20_000).nullable().optional(),
    published: z.boolean(),
  })
  .strict();
const CollectionIn = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{2,60}$/),
    titleBn: z.string().trim().min(1).max(80),
    titleEn: z.string().trim().max(80).nullable().optional(),
    active: z.boolean().default(false),
    sortOrder: z.number().int().default(0),
    productIds: z.array(z.string().uuid()).max(48).default([]),
  })
  .strict();
const BannerPatch = z
  .object({
    titleBn: z.string().trim().min(1).max(120).optional(),
    altBn: z.string().trim().min(1).max(160).optional(),
    linkUrl: z.string().regex(/^\/[A-Za-z0-9/_?=&-]*$/, 'internal links only').nullable().optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
const Profile = z.object({ fullName: z.string().trim().min(1).max(120) }).strict();

@Controller()
export class ContentController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  // ── public ──

  /** Home content: only approved, active, in-date banners and active collections (PRD: nothing invented). */
  @Get('content/home')
  @Public()
  async home(@Res({ passthrough: true }) res: Response) {
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    const now = this.clock.now();
    const inDate = { AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] };
    const [banners, collections, pages, maintenance] = await Promise.all([
      this.prisma.banner.findMany({ where: { active: true, approvedBy: { not: null }, ...inDate }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.collection.findMany({ where: { active: true, ...inDate, items: { some: { product: { status: 'ACTIVE' } } } }, orderBy: { sortOrder: 'asc' }, select: { slug: true, titleBn: true, titleEn: true } }),
      this.prisma.contentPage.findMany({ where: { published: true }, select: { slug: true, titleBn: true, titleEn: true } }),
      this.settings.get('storefront.maintenance'),
    ]);
    return {
      banners: banners.map((b) => ({ id: b.id, titleBn: b.titleBn, altBn: b.altBn, imageUrl: this.media.url(b.imageKey), linkUrl: b.linkUrl })),
      collections,
      pages,
      maintenance,
    };
  }

  @Get('content/pages/:slug')
  @Public()
  async page(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const p = await this.prisma.contentPage.findFirst({ where: { slug, published: true } });
    if (!p) throw notFound('Page');
    res.setHeader('cache-control', 'public, s-maxage=60, stale-while-revalidate=300');
    return { slug: p.slug, titleBn: p.titleBn, bodyBn: p.bodyBn, titleEn: p.titleEn, bodyEn: p.bodyEn, version: p.version, updatedAt: p.updatedAt };
  }

  // ── customer profile ──

  @Get('me/profile')
  @CustomerOnly()
  profile(@CurrentPrincipal() p: Principal) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: p.userId }, select: { id: true, fullName: true, phone: true, email: true, createdAt: true } });
  }

  @Patch('me/profile')
  @CustomerOnly()
  updateProfile(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    return this.prisma.user.update({ where: { id: p.userId }, data: parse(Profile, body), select: { id: true, fullName: true, phone: true } });
  }

  // ── admin: pages ──

  @Get('admin/pages')
  @RequirePermission('content.manage')
  async pages() {
    const rows = await this.prisma.contentPage.findMany();
    return PAGE_SLUGS.map((slug) => rows.find((r) => r.slug === slug) ?? { slug, titleBn: '', bodyBn: '', titleEn: null, bodyEn: null, published: false, version: 0 });
  }

  @Put('admin/pages/:slug')
  @RequirePermission('content.manage')
  async putPage(@CurrentPrincipal() p: StaffPrincipal, @Param('slug') slug: string, @Body() body: unknown, @Req() req: Request) {
    if (!(PAGE_SLUGS as readonly string[]).includes(slug)) throw notFound('Page');
    const b = parse(PageIn, body);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.contentPage.findUnique({ where: { slug } });
      const page = await tx.contentPage.upsert({
        where: { slug },
        update: { ...b, version: { increment: 1 }, updatedBy: p.userId },
        create: { slug, ...b, updatedBy: p.userId },
      });
      await this.audit.record({ action: 'content.page_update', entityType: 'content_page', entityId: slug, before: before ? { version: before.version, published: before.published } : null, after: { version: page.version, published: page.published } }, { principal: p }, req, tx);
      return page;
    });
  }

  // ── admin: collections ──

  @Get('admin/collections')
  @RequirePermission('content.manage')
  collections() {
    return this.prisma.collection.findMany({ include: { items: { orderBy: { sortOrder: 'asc' }, select: { productId: true } } }, orderBy: { sortOrder: 'asc' } });
  }

  @Post('admin/collections')
  @RequirePermission('content.manage')
  async createCollection(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CollectionIn, body);
    if (await this.prisma.collection.findUnique({ where: { slug: b.slug } })) throw new AppError('CONFLICT', 'Collection slug exists');
    return this.saveCollection(null, b, p, req);
  }

  @Put('admin/collections/:id')
  @RequirePermission('content.manage')
  async updateCollection(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CollectionIn, body);
    if (!(await this.prisma.collection.findUnique({ where: { id } }))) throw notFound('Collection');
    return this.saveCollection(id, b, p, req);
  }

  private saveCollection(id: string | null, b: z.infer<typeof CollectionIn>, p: StaffPrincipal, req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.product.count({ where: { id: { in: b.productIds } } });
      if (found !== new Set(b.productIds).size) throw new AppError('VALIDATION_FAILED', 'Unknown product in collection');
      const { productIds, ...data } = b;
      const c = id ? await tx.collection.update({ where: { id }, data }) : await tx.collection.create({ data: { id: newId(), ...data } });
      await tx.collectionItem.deleteMany({ where: { collectionId: c.id } });
      await tx.collectionItem.createMany({ data: [...new Set(productIds)].map((productId, i) => ({ collectionId: c.id, productId, sortOrder: i })) });
      await this.audit.record({ action: 'content.collection_save', entityType: 'collection', entityId: c.id, after: { slug: c.slug, active: c.active, products: productIds.length } }, { principal: p }, req, tx);
      return c;
    });
  }

  // ── admin: banners ──

  @Get('admin/banners')
  @RequirePermission('content.manage')
  async banners() {
    const rows = await this.prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((b) => ({ ...b, imageUrl: this.media.url(b.imageKey) }));
  }

  /** Multipart: field `file` + text fields titleBn, altBn. New banners start inactive. */
  @Post('admin/banners')
  @RequirePermission('content.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async createBanner(@CurrentPrincipal() p: StaffPrincipal, @UploadedFile() file: UploadedImage | undefined, @Body() body: unknown, @Req() req: Request) {
    const b = parse(z.object({ titleBn: z.string().trim().min(1).max(120), altBn: z.string().trim().min(1).max(160) }).strict(), body);
    if (!file) throw new AppError('VALIDATION_FAILED', 'Image file required');
    const img = await this.media.storeImage('banners', file.buffer);
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.banner.create({ data: { id: newId(), titleBn: b.titleBn, altBn: b.altBn, imageKey: img.key, active: false } });
      await this.audit.record({ action: 'content.banner_create', entityType: 'banner', entityId: banner.id, after: { titleBn: b.titleBn } }, { principal: p }, req, tx);
      return banner;
    });
  }

  /** Activating a banner records the approver (only approved banners are shown). */
  @Patch('admin/banners/:id')
  @RequirePermission('content.manage')
  async patchBanner(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(BannerPatch, body);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.banner.findUnique({ where: { id } }))) throw notFound('Banner');
      const banner = await tx.banner.update({ where: { id }, data: { ...b, ...(b.active ? { approvedBy: p.userId } : {}) } });
      await this.audit.record({ action: 'content.banner_update', entityType: 'banner', entityId: id, after: b }, { principal: p }, req, tx);
      return banner;
    });
  }

  // ── admin: product images ──

  @Post('admin/products/:id/images')
  @RequirePermission('catalog.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  async uploadProductImage(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('id', ParseUUIDPipe) productId: string,
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const b = parse(z.object({ altBn: z.string().trim().min(1).max(160), altEn: z.string().trim().max(160).optional() }).strict(), body);
    if (!file) throw new AppError('VALIDATION_FAILED', 'Image file required');
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('Product');
    const img = await this.media.storeImage('products', file.buffer);
    return this.prisma.$transaction(async (tx) => {
      const sortOrder = await tx.productImage.count({ where: { productId } });
      const row = await tx.productImage.create({ data: { id: newId(), productId, storageKey: img.key, altBn: b.altBn, altEn: b.altEn ?? null, width: img.width, height: img.height, sortOrder } });
      await this.audit.record({ action: 'catalog.image_upload', entityType: 'product', entityId: productId, after: { imageId: row.id } }, { principal: p }, req, tx);
      return { ...row, url: this.media.url(row.storageKey) };
    });
  }

  @Post('admin/product-images/:imageId/delete')
  @RequirePermission('catalog.manage')
  async deleteProductImage(@CurrentPrincipal() p: StaffPrincipal, @Param('imageId', ParseUUIDPipe) imageId: string, @Req() req: Request) {
    return this.prisma.$transaction(async (tx) => {
      const img = await tx.productImage.findUnique({ where: { id: imageId } });
      if (!img) throw notFound('Image');
      await tx.productImage.delete({ where: { id: imageId } });
      await this.audit.record({ action: 'catalog.image_delete', entityType: 'product', entityId: img.productId, after: { imageId } }, { principal: p }, req, tx);
      return { ok: true };
    });
  }
}
