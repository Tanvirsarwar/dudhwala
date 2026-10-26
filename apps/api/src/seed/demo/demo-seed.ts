/**
 * DEMO seed — non-production only.
 *
 *   pnpm --filter @dudhwala/api db:seed:demo    # load (idempotent)
 *   pnpm --filter @dudhwala/api db:purge:demo   # remove every demo row
 *
 * Everything created here is marked so it can be found and deleted:
 *   slugs start with "demo-", SKUs start with "DEMO-", the outlet code is "DEMO-1",
 *   and every product description says it is demo data.
 * Refuses to run when NODE_ENV is production.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseTaka } from '@dudhwala/shared';
import type { Env } from '../../config/env.js';
import { newId } from '../../common/crypto.js';
import { PrismaService, type Tx } from '../../prisma/prisma.service.js';
import { seedSystem } from '../system-seed.js';

interface DemoFile {
  _notice: string;
  source: string;
  category: { slug: string; nameBn: string; nameEn: string };
  products: {
    slug: string;
    nameEn: string;
    image: string;
    soldOut: boolean;
    variants: { labelBn: string; packSize: number; packUnit: 'G' | 'KG' | 'PCS'; taka: number }[];
  }[];
}

export const DEMO = { slugPrefix: 'demo-', skuPrefix: 'DEMO-', outletCode: 'DEMO-1', stockPerVariant: 20 } as const;

const DEMO_NOTE_BN = 'ডেমো তথ্য — আসল দুধওয়ালা পণ্য বা দাম নয়। লঞ্চের আগে মুছে ফেলা হবে।';

export function loadDemoFile(): DemoFile {
  return JSON.parse(readFileSync(new URL('./wellfood-premium-cakes.json', import.meta.url), 'utf8')) as DemoFile;
}

export function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo data must never be loaded into production');
}

export async function seedDemo(tx: Tx, data: DemoFile = loadDemoFile()): Promise<{ products: number; variants: number }> {
  assertNotProduction();
  await seedSystem(tx);

  const outlet =
    (await tx.outlet.findUnique({ where: { code: DEMO.outletCode } })) ??
    (await tx.outlet.create({
      data: { id: newId(), code: DEMO.outletCode, nameBn: 'ডেমো আউটলেট', nameEn: 'Demo outlet', addressLine: 'DEMO — not a real address', status: 'ACTIVE', acceptsOnlineOrders: true },
    }));

  const catSlug = data.category.slug.startsWith(DEMO.slugPrefix) ? data.category.slug : DEMO.slugPrefix + data.category.slug;
  const category = await tx.category.upsert({
    where: { slug: catSlug },
    update: {},
    create: { id: newId(), slug: catSlug, nameBn: data.category.nameBn, nameEn: data.category.nameEn },
  });

  let variants = 0;
  for (const [i, p] of data.products.entries()) {
    const slug = DEMO.slugPrefix + p.slug;
    const product = await tx.product.upsert({
      where: { slug },
      update: {},
      create: {
        id: newId(),
        categoryId: category.id,
        slug,
        nameBn: p.nameEn, // no approved Bangla name exists for demo items
        nameEn: p.nameEn,
        descriptionBn: DEMO_NOTE_BN,
        descriptionEn: `DEMO data from ${data.source} — not a Dudhwala product or price.`,
        status: 'ACTIVE',
      },
    });
    if ((await tx.productImage.count({ where: { productId: product.id } })) === 0) {
      await tx.productImage.create({ data: { id: newId(), productId: product.id, storageKey: p.image, altBn: p.nameEn, altEn: p.nameEn, width: 600, height: 600 } });
    }
    for (const [j, v] of p.variants.entries()) {
      const sku = `${DEMO.skuPrefix}${String(i + 1).padStart(2, '0')}-${j + 1}`;
      const variant = await tx.productVariant.upsert({
        where: { sku },
        update: {},
        create: {
          id: newId(),
          productId: product.id,
          sku,
          labelBn: v.labelBn,
          packSize: v.packSize,
          packUnit: v.packUnit,
          pricePoisha: parseTaka(String(v.taka)),
          status: 'ACTIVE',
          sortOrder: j,
        },
      });
      await tx.inventory.upsert({
        where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } },
        update: {},
        create: {
          id: newId(),
          outletId: outlet.id,
          productVariantId: variant.id,
          quantityOnHand: p.soldOut ? 0 : DEMO.stockPerVariant,
          isListed: true,
          lowStockThreshold: 3,
        },
      });
      variants++;
    }
  }
  await seedDemoDelivery(tx, outlet.id);
  return { products: data.products.length, variants };
}

/** DEMO delivery set-up: real Sylhet neighbourhood names marked "(ডেমো)", demo fee and slots. Not business decisions. */
export const DEMO_AREAS = [
  ['demo-zindabazar', 'জিন্দাবাজার (ডেমো)'],
  ['demo-amberkhana', 'আম্বরখানা (ডেমো)'],
  ['demo-jalalabad', 'জালালাবাদ (ডেমো)'],
] as const;
const DEMO_SLOTS = [
  ['10:00', '12:00'],
  ['16:00', '18:00'],
  ['19:00', '21:00'],
] as const;

async function seedDemoDelivery(tx: Tx, outletId: string): Promise<void> {
  let zone = await tx.deliveryZone.findFirst({ where: { name: 'DEMO zone' } });
  if (!zone) zone = await tx.deliveryZone.create({ data: { id: newId(), name: 'DEMO zone' } });
  for (const [slug, nameBn] of DEMO_AREAS) {
    const area = await tx.area.upsert({ where: { slug }, update: {}, create: { id: newId(), slug, nameBn } });
    await tx.deliveryZoneArea.upsert({ where: { zoneId_areaId: { zoneId: zone.id, areaId: area.id } }, update: {}, create: { zoneId: zone.id, areaId: area.id } });
  }
  await tx.outletZoneRule.upsert({
    where: { outletId_zoneId: { outletId, zoneId: zone.id } },
    update: {},
    create: { outletId, zoneId: zone.id, active: true, priority: 100, deliveryFeePoisha: 6_000, freeDeliveryMinPoisha: 500_000, minOrderPoisha: 0, codEnabled: true, codMaxOrderPoisha: 1_000_000 },
  });
  if ((await tx.deliverySlotTemplate.count({ where: { outletId } })) === 0) {
    for (let weekday = 0; weekday < 7; weekday++) {
      for (const [start, end] of DEMO_SLOTS) {
        await tx.deliverySlotTemplate.create({
          data: { id: newId(), outletId, weekday, startsAt: new Date(`1970-01-01T${start}:00Z`), endsAt: new Date(`1970-01-01T${end}:00Z`), capacity: 10, cutoffMinutes: 60 },
        });
      }
    }
  }
  // Show the online-payment flow (simulator) in demos.
  if (!(await tx.setting.findFirst({ where: { key: 'payments.online.enabled', outletId: null } }))) {
    await tx.setting.create({ data: { id: newId(), key: 'payments.online.enabled', scope: 'GLOBAL', value: true } });
  }
}

/** Removes every demo row. Order history keeps its snapshots (order_item.product_variant_id is SET NULL). */
export async function purgeDemo(tx: Tx): Promise<{ products: number }> {
  const products = await tx.product.findMany({ where: { slug: { startsWith: DEMO.slugPrefix } }, select: { id: true } });
  const ids = products.map((p) => p.id);
  const variantIds = (await tx.productVariant.findMany({ where: { productId: { in: ids } }, select: { id: true } })).map((v) => v.id);
  // stock_movement is append-only by design (it cannot be deleted). If anyone moved demo stock,
  // those variants are archived and unlisted instead of deleted, so history stays intact.
  const withMovements = new Set(
    (await tx.stockMovement.findMany({ where: { productVariantId: { in: variantIds } }, select: { productVariantId: true }, distinct: ['productVariantId'] })).map((m) => m.productVariantId),
  );
  await purgeDemoDelivery(tx);
  await tx.cartItem.deleteMany({ where: { productVariantId: { in: variantIds } } });
  await tx.inventory.deleteMany({ where: { productVariantId: { in: variantIds.filter((v) => !withMovements.has(v)) } } });
  if (withMovements.size > 0) {
    // Keep rows referenced by append-only history, but take them off sale permanently.
    await tx.inventory.updateMany({ where: { productVariantId: { in: [...withMovements] } }, data: { isListed: false } });
    await tx.productVariant.updateMany({ where: { id: { in: [...withMovements] } }, data: { status: 'ARCHIVED' } });
    await tx.product.updateMany({ where: { id: { in: ids } }, data: { status: 'ARCHIVED' } });
    return { products: ids.length };
  }
  await tx.productImage.deleteMany({ where: { productId: { in: ids } } });
  await tx.collectionItem.deleteMany({ where: { productId: { in: ids } } });
  await tx.productVariant.deleteMany({ where: { id: { in: variantIds } } });
  await tx.product.deleteMany({ where: { id: { in: ids } } });
  await tx.category.deleteMany({ where: { slug: { startsWith: DEMO.slugPrefix }, products: { none: {} } } });
  const outlet = await tx.outlet.findUnique({ where: { code: DEMO.outletCode }, include: { _count: { select: { inventory: true, orders: true, staff: true } } } });
  if (outlet && outlet._count.inventory === 0 && outlet._count.orders === 0 && outlet._count.staff === 0) await tx.outlet.delete({ where: { id: outlet.id } });
  return { products: ids.length };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url || (mode !== 'seed' && mode !== 'purge')) {
    console.error('Usage: DATABASE_URL=… demo-seed.js seed|purge');
    process.exit(2);
  }
  const prisma = new PrismaService({ DATABASE_URL: url } as Env);
  try {
    if (mode === 'seed') {
      assertNotProduction();
      console.log(await prisma.$transaction((tx) => seedDemo(tx), { timeout: 60_000 }));
    } else {
      console.log(await prisma.$transaction((tx) => purgeDemo(tx), { timeout: 60_000 }));
    }
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

async function purgeDemoDelivery(tx: Tx): Promise<void> {
  const outlet = await tx.outlet.findUnique({ where: { code: DEMO.outletCode }, include: { _count: { select: { orders: true } } } });
  if (outlet && outlet._count.orders > 0) {
    // Orders reference slots and the outlet: keep history, but switch everything off.
    await tx.outlet.update({ where: { id: outlet.id }, data: { status: 'CLOSED', acceptsOnlineOrders: false } });
    await tx.outletZoneRule.updateMany({ where: { outletId: outlet.id }, data: { active: false } });
    await tx.area.updateMany({ where: { slug: { startsWith: DEMO.slugPrefix } }, data: { active: false } });
    return;
  }
  if (outlet) {
    await tx.deliverySlot.deleteMany({ where: { outletId: outlet.id } });
    await tx.deliverySlotTemplate.deleteMany({ where: { outletId: outlet.id } });
    await tx.outletZoneRule.deleteMany({ where: { outletId: outlet.id } });
  }
  const zone = await tx.deliveryZone.findFirst({ where: { name: 'DEMO zone' } });
  if (zone && (await tx.outletZoneRule.count({ where: { zoneId: zone.id } })) === 0) {
    await tx.deliveryZoneArea.deleteMany({ where: { zoneId: zone.id } });
    await tx.deliveryZone.delete({ where: { id: zone.id } });
  }
  await tx.cart.updateMany({ where: { area: { slug: { startsWith: DEMO.slugPrefix } } }, data: { areaId: null } });
  await tx.address.deleteMany({ where: { area: { slug: { startsWith: DEMO.slugPrefix } } } });
  await tx.area.deleteMany({ where: { slug: { startsWith: DEMO.slugPrefix }, zones: { none: {} }, orders: { none: {} } } });
  await tx.setting.deleteMany({ where: { key: 'payments.online.enabled', outletId: null, updatedById: null } });
}
