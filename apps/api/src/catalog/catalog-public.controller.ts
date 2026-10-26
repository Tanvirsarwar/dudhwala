import { Controller, Get, Inject, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../access/decorators.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AvailabilityService } from './availability.service.js';
import { MediaService } from '../media/media.js';

const ListQuery = z
  .object({
    category: z.string().max(80).optional(),
    collection: z.string().max(60).optional(),
    q: z.string().trim().max(80).optional(),
    sort: z.enum(['relevance', 'price_asc', 'price_desc', 'newest']).default('relevance'),
    inStock: z.enum(['true', 'false']).optional(),
    areaId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  })
  .strict();
const AreaQuery = z.object({ areaId: z.string().uuid().optional() }).strict();

/** Public catalogue (API_SPECIFICATION §3). Only ACTIVE products and variants, never internal fields. */
@Controller()
export class CatalogPublicController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private cache(res: Response): void {
    // Public, shared-cacheable; availability is advisory and re-checked at checkout.
    res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=120');
  }

  @Get('catalog/categories')
  @Public()
  async categories(@Res({ passthrough: true }) res: Response) {
    this.cache(res);
    return this.prisma.category.findMany({
      where: { active: true, products: { some: { status: 'ACTIVE' } } },
      select: { id: true, slug: true, nameBn: true, nameEn: true, parentId: true },
      orderBy: [{ sortOrder: 'asc' }, { nameBn: 'asc' }],
    });
  }

  @Get('catalog/products')
  @Public()
  async products(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(ListQuery, query);
    this.cache(res);
    const where: Prisma.ProductWhereInput = {
      status: 'ACTIVE',
      category: { active: true, ...(q.category ? { slug: q.category } : {}) },
      variants: { some: { status: 'ACTIVE' } },
      ...(q.collection ? { inCollections: { some: { collection: { slug: q.collection, active: true } } } } : {}),
      ...(q.q ? { OR: [{ nameBn: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const rows = await this.prisma.product.findMany({
      where,
      include: { variants: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } }, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, category: { select: { slug: true } } },
      orderBy: q.sort === 'newest' ? { createdAt: 'desc' } : { nameEn: 'asc' },
    });
    const avail = await this.availability.forVariants(rows.flatMap((r) => r.variants.map((v) => v.id)), q.areaId ?? null);
    let items = rows.map((p) => {
      const variants = p.variants.map((v) => ({
        id: v.id,
        labelBn: v.labelBn,
        labelEn: v.labelEn,
        pricePoisha: v.pricePoisha,
        compareAtPoisha: v.compareAtPoisha,
        availability: avail.get(v.id)?.availability ?? 'OUT_OF_STOCK',
      }));
      return {
        id: p.id,
        slug: p.slug,
        nameBn: p.nameBn,
        nameEn: p.nameEn,
        categorySlug: p.category.slug,
        image: p.images[0] ? { url: this.media.url(p.images[0].storageKey), altBn: p.images[0].altBn } : null,
        fromPricePoisha: Math.min(...variants.map((v) => v.pricePoisha)),
        inStock: variants.some((v) => v.availability === 'IN_STOCK'),
        variants,
      };
    });
    if (q.inStock === 'true') items = items.filter((i) => i.inStock);
    if (q.sort === 'price_asc') items.sort((a, b) => a.fromPricePoisha - b.fromPricePoisha);
    if (q.sort === 'price_desc') items.sort((a, b) => b.fromPricePoisha - a.fromPricePoisha);
    if (q.sort === 'relevance' && q.q) {
      const term = q.q.toLowerCase();
      const score = (i: (typeof items)[number]) => ((i.nameEn ?? '').toLowerCase().startsWith(term) || i.nameBn.startsWith(q.q ?? '') ? 0 : 1);
      items.sort((a, b) => score(a) - score(b));
    }
    const total = items.length;
    const start = (q.page - 1) * q.limit;
    return { data: items.slice(start, start + q.limit), page: q.page, limit: q.limit, total, areaChecked: Boolean(q.areaId) };
  }

  @Get('catalog/products/:slug')
  @Public()
  async product(@Param('slug') slug: string, @Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const q = parse(AreaQuery, query);
    if (!/^[a-z0-9-]{1,120}$/.test(slug)) throw notFound('Product');
    const p = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', category: { active: true } },
      include: { variants: { where: { status: 'ACTIVE' }, orderBy: { sortOrder: 'asc' } }, images: { orderBy: { sortOrder: 'asc' } }, category: { select: { slug: true, nameBn: true, nameEn: true } } },
    });
    if (!p || p.variants.length === 0) throw notFound('Product');
    this.cache(res);
    const avail = await this.availability.forVariants(p.variants.map((v) => v.id), q.areaId ?? null);
    // Optional content: only fields the business supplied are returned (PRD FR-2).
    const content = Object.fromEntries(
      (['descriptionBn', 'descriptionEn', 'ingredientsBn', 'ingredientsEn', 'allergensBn', 'allergensEn', 'storageBn', 'storageEn', 'shelfLifeBn', 'shelfLifeEn'] as const)
        .filter((k) => p[k])
        .map((k) => [k, p[k]]),
    );
    return {
      id: p.id,
      slug: p.slug,
      nameBn: p.nameBn,
      nameEn: p.nameEn,
      category: p.category,
      images: p.images.map((i) => ({ url: this.media.url(i.storageKey), altBn: i.altBn, altEn: i.altEn, width: i.width, height: i.height })),
      content,
      variants: p.variants.map((v) => ({
        id: v.id,
        labelBn: v.labelBn,
        labelEn: v.labelEn,
        pricePoisha: v.pricePoisha,
        compareAtPoisha: v.compareAtPoisha,
        availability: avail.get(v.id)?.availability ?? 'OUT_OF_STOCK',
        maxQty: Math.min(99, avail.get(v.id)?.maxQty ?? 0),
      })),
      areaChecked: Boolean(q.areaId),
    };
  }

  @Get('delivery/areas')
  @Public()
  async areas(@Res({ passthrough: true }) res: Response) {
    this.cache(res);
    const served = await this.prisma.area.findMany({
      where: { active: true, zones: { some: { zone: { active: true, rules: { some: { active: true, outlet: { status: 'ACTIVE', acceptsOnlineOrders: true } } } } } } },
      select: { id: true, slug: true, nameBn: true, nameEn: true },
      orderBy: { nameBn: 'asc' },
    });
    return served;
  }

  @Get('delivery/check')
  @Public()
  async check(@Query() query: unknown) {
    const q = parse(z.object({ areaId: z.string().uuid() }).strict(), query);
    return { serviceable: (await this.availability.servingOutletIds(q.areaId)).length > 0 };
  }
}
