/**
 * Idempotent catalogue import. Reads the product master (names and Outer City marks only: no prices, pack sizes,
 * stock or photos exist in the source) and creates what is missing:
 *   - categories by slug
 *   - products by slug (the source id), each with ONE blank option whose price is NULL
 * Existing rows are never changed, so admin edits survive a re-run. New products are hidden (not for sale) unless
 * --activate is passed; a product with no price cannot be ordered either way.
 *
 *   DATABASE_URL=… node dist/cli/import-catalogue.js [--file ../../demo/mock-api/catalogue.json] [--activate]
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { outerFromApi } from '../catalog/catalog.service.js';
import { newId } from '../common/crypto.js';

const Catalogue = z.object({
  categories: z.array(z.object({ slug: z.string().regex(/^[a-z0-9-]{1,80}$/), nameBn: z.string().min(1), nameEn: z.string().min(1) })).min(1),
  products: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,120}$/),
        category: z.string(),
        nameBn: z.string().min(1),
        nameEn: z.string().min(1),
        nameVerified: z.boolean(),
        outerCity: z.enum(['approved', 'disabled', 'pending_verification', 'pending_confirmation']).nullable().optional(),
      }),
    )
    .min(1),
});

export interface ImportResult {
  categoriesCreated: number;
  productsCreated: number;
  productsSkipped: number;
}

export async function importCatalogue(prisma: PrismaService, raw: unknown, opts: { activate?: boolean } = {}): Promise<ImportResult> {
  const cat = Catalogue.parse(raw);
  const known = new Set(cat.categories.map((c) => c.slug));
  for (const p of cat.products) if (!known.has(p.category)) throw new Error(`Product ${p.id} uses unknown category ${p.category}`);
  return prisma.$transaction(async (tx) => {
    const r: ImportResult = { categoriesCreated: 0, productsCreated: 0, productsSkipped: 0 };
    const ids = new Map<string, string>();
    for (const [i, c] of cat.categories.entries()) {
      const found = await tx.category.findUnique({ where: { slug: c.slug } });
      if (found) ids.set(c.slug, found.id);
      else {
        const created = await tx.category.create({ data: { id: newId(), slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn, sortOrder: i } });
        ids.set(c.slug, created.id);
        r.categoriesCreated++;
      }
    }
    for (const p of cat.products) {
      if (await tx.product.findUnique({ where: { slug: p.id } })) {
        r.productsSkipped++;
        continue;
      }
      await tx.product.create({
        data: {
          id: newId(),
          slug: p.id,
          categoryId: ids.get(p.category) as string,
          nameBn: p.nameBn,
          nameEn: p.nameEn,
          nameVerified: p.nameVerified,
          outerCityStatus: outerFromApi(p.outerCity ?? null),
          active: opts.activate ?? false,
          variants: { create: [{ id: newId() }] },
        },
      });
      r.productsCreated++;
    }
    await tx.auditLog.create({ data: { id: newId(), actorRole: 'CLI', action: 'catalogue.imported', entityType: 'catalogue', after: { ...r } } });
    return r;
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { file: { type: 'string' }, activate: { type: 'boolean' } } });
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const file = values.file ?? '../../demo/mock-api/catalogue.json';
  const prisma = new PrismaService({ DATABASE_URL: url, DATABASE_CA_CERT: process.env.DATABASE_CA_CERT ?? '' } as Env);
  try {
    const r = await importCatalogue(prisma, JSON.parse(readFileSync(file, 'utf8')), { activate: values.activate ?? false });
    console.log(`Catalogue import: ${r.categoriesCreated} categories and ${r.productsCreated} products created, ${r.productsSkipped} already present.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
