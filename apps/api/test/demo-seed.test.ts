import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO, loadDemoFile, purgeDemo, seedDemo } from '../src/seed/demo/demo-seed.js';
import { resetDb, startHarness, type Harness } from './support/harness.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => resetDb(h.prisma));

describe('demo seed', () => {
  it('loads labelled demo products idempotently with sold-out items at zero stock', async () => {
    const file = loadDemoFile();
    const r1 = await h.prisma.$transaction((tx) => seedDemo(tx));
    const r2 = await h.prisma.$transaction((tx) => seedDemo(tx));
    expect(r1).toEqual(r2);
    expect(await h.prisma.product.count()).toBe(file.products.length);
    expect(await h.prisma.product.count({ where: { NOT: { slug: { startsWith: DEMO.slugPrefix } } } })).toBe(0);
    expect(await h.prisma.productVariant.count({ where: { NOT: { sku: { startsWith: DEMO.skuPrefix } } } })).toBe(0);
    const ferrero = await h.prisma.productVariant.findFirstOrThrow({ where: { product: { slug: 'demo-ferrero-rocher-chocolate-cake' } } });
    expect(ferrero.pricePoisha).toBe(255_000);
    const soldOut = await h.prisma.inventory.findFirstOrThrow({ where: { variant: { product: { slug: 'demo-premium-black-forest-cake' } } } });
    expect(soldOut.quantityOnHand).toBe(0);
    expect(await h.prisma.area.count({ where: { nameBn: { endsWith: '(ডেমো)' } } })).toBe(3);
    expect(await h.prisma.deliverySlotTemplate.count()).toBe(21);
    const descs = await h.prisma.product.findMany({ select: { descriptionEn: true } });
    expect(descs.every((d) => d.descriptionEn?.startsWith('DEMO'))).toBe(true);
  });

  it('purges every demo row', async () => {
    await h.prisma.$transaction((tx) => seedDemo(tx));
    await h.prisma.$transaction((tx) => purgeDemo(tx));
    expect(await h.prisma.product.count()).toBe(0);
    expect(await h.prisma.productVariant.count()).toBe(0);
    expect(await h.prisma.inventory.count()).toBe(0);
    expect(await h.prisma.category.count()).toBe(0);
    expect(await h.prisma.outlet.count({ where: { code: DEMO.outletCode } })).toBe(0);
    expect(await h.prisma.area.count()).toBe(0);
    expect(await h.prisma.deliveryZone.count()).toBe(0);
    expect(await h.prisma.setting.count()).toBe(0);
  });

  it('refuses to run in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(h.prisma.$transaction((tx) => seedDemo(tx))).rejects.toThrow(/never be loaded into production/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
