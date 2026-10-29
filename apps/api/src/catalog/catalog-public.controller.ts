import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../access/decorators.js';
import { notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const ListQuery = z
  .object({
    category: z.string().max(80).optional(),
    q: z.string().trim().max(80).optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc']).optional(),
    inStock: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  })
  .passthrough();

@Controller('catalog')
export class CatalogPublicController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
  ) {}

  @Get('categories')
  @Public()
  async categories() {
    const rows = await this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
    return rows.map((c) => ({ id: c.id, slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn }));
  }

  @Get('products')
  @Public()
  async products(@Query() query: unknown) {
    const q = parse(ListQuery, query);
    const where: Prisma.ProductWhereInput = this.catalog.liveWhere({
      ...(q.category ? { category: { slug: q.category, active: true } } : {}),
      ...(q.q ? { OR: [{ nameBn: { contains: q.q, mode: 'insensitive' } }, { nameEn: { contains: q.q, mode: 'insensitive' } }] } : {}),
    });
    // Price sorting happens in memory (the catalogue is a few hundred rows at most); unknown prices sort last.
    const rows = await this.prisma.product.findMany({ where, include: { category: true, variants: true }, orderBy: { createdAt: 'desc' } });
    let cards = await this.catalog.cards(this.prisma, rows);
    if (q.inStock === 'true') cards = cards.filter((c) => c.inStock);
    const price = (c: (typeof cards)[number]) => c.fromPricePoisha ?? Number.MAX_SAFE_INTEGER;
    if (q.sort === 'price_asc') cards.sort((a, b) => price(a) - price(b));
    if (q.sort === 'price_desc') cards.sort((a, b) => (b.fromPricePoisha ?? -1) - (a.fromPricePoisha ?? -1));
    return { data: cards.slice((q.page - 1) * q.limit, q.page * q.limit), page: q.page, limit: q.limit, total: cards.length };
  }

  @Get('products/:slug')
  @Public()
  async product(@Param('slug') slug: string) {
    const p = await this.prisma.product.findFirst({ where: this.catalog.liveWhere({ slug }), include: { category: true, variants: true } });
    if (!p) throw notFound('Product');
    return this.catalog.detail(this.prisma, p);
  }
}
