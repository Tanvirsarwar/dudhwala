import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDb, startHarness, type Harness } from './support/harness.js';
import { makeOutletReady, makeProduct, staffAt, superAdmin } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
});

describe('product image delivery (regression)', () => {
  it('an uploaded photo is returned by the public catalogue and the URL serves a WebP', async () => {
    const sa = await superAdmin(h);
    const { product, variants } = await makeProduct(h, [120]);
    await makeOutletReady(h, [variants[0]!.id], { stock: 5 });
    const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#2d308f' } }).png().toBuffer();
    await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'দই').attach('file', png, 'a.png').expect(201);

    const list = await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200);
    const url = list.body.data[0].image.url as string;
    expect(url).toMatch(/\/v1\/media\/products\/[0-9a-f-]+\.webp$/);
    const detail = await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}`).expect(200);
    expect(detail.body.images[0].url).toBe(url);

    for (let i = 0; i < 2; i++) {
      // second fetch = "after a refresh": the file must still be there and cacheable
      const img = await request(h.app.getHttpServer()).get(new URL(url).pathname).expect(200);
      expect(img.headers['content-type']).toBe('image/webp');
      expect(img.headers['cache-control']).toMatch(/immutable/);
      expect((await sharp(img.body as Buffer).metadata()).format).toBe('webp');
    }
  });

  it('a product without a photo has image: null (the storefront shows its placeholder)', async () => {
    const { variants } = await makeProduct(h, [120]);
    await makeOutletReady(h, [variants[0]!.id], { stock: 5 });
    const list = await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200);
    expect(list.body.data[0].image).toBeNull();
  });

  it('a removed photo stops being served by the catalogue', async () => {
    const sa = await superAdmin(h);
    const { product } = await makeProduct(h, [120]);
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#fff' } }).png().toBuffer();
    const up = await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'x').attach('file', png, 'a.png').expect(201);
    await sa.post(`/v1/admin/product-images/${up.body.id}/delete`).expect(201);
    const detail = await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}`).expect(200);
    expect(detail.body.images).toEqual([]);
  });
});

describe('bulk price CSV', () => {
  it('exports every variant with a BOM and audits the export', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120, 250]);
    const res = await sa.get('/v1/admin/variants/export.csv').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text.startsWith('﻿sku,product,name,label,status,priceTaka,compareAtTaka')).toBe(true);
    expect(res.text).toContain(variants[0]!.sku);
    expect(res.text).toContain('120.00');
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.export_csv' } })).toBe(1);
  });

  it('dry run reports each row and changes nothing', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120]);
    const res = await sa.post('/v1/admin/variants/bulk-price').send({ dryRun: true, rows: [{ sku: variants[0]!.sku, priceTaka: '135.50' }] }).expect(200);
    expect(res.body).toMatchObject({ applied: false, dryRun: true, invalid: 0, rows: [{ ok: true, beforePoisha: 12000, afterPoisha: 13550 }] });
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).pricePoisha).toBe(12000);
  });

  it('applies valid files in one transaction and writes an audit entry per change', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120, 250]);
    const res = await sa
      .post('/v1/admin/variants/bulk-price')
      .send({ dryRun: false, rows: [{ sku: variants[0]!.sku, priceTaka: '130', compareAtTaka: '150' }, { sku: variants[1]!.sku.toLowerCase(), priceTaka: '250' }] })
      .expect(200);
    expect(res.body).toMatchObject({ applied: true, invalid: 0, unchanged: 1 });
    const v0 = await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } });
    expect([v0.pricePoisha, v0.compareAtPoisha]).toEqual([13000, 15000]);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.price_change' } })).toBe(1);
  });

  it('keeps the compare-at price when the file has no compare-at column, clears it on a blank cell', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120, 250]);
    await h.prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { compareAtPoisha: 20000 } });
    await h.prisma.productVariant.update({ where: { id: variants[1]!.id }, data: { compareAtPoisha: 30000 } });
    await sa.post('/v1/admin/variants/bulk-price').send({ dryRun: false, rows: [{ sku: variants[0]!.sku, priceTaka: '130' }, { sku: variants[1]!.sku, priceTaka: '260', compareAtTaka: '' }] }).expect(200);
    const [a, b] = await Promise.all(variants.map((v) => h.prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })));
    expect([a!.pricePoisha, a!.compareAtPoisha]).toEqual([13000, 20000]);
    expect([b!.pricePoisha, b!.compareAtPoisha]).toEqual([26000, null]);
    // an omitted compare-at that is no longer above the new price is rejected, not silently kept
    const bad = await sa.post('/v1/admin/variants/bulk-price').send({ dryRun: true, rows: [{ sku: variants[0]!.sku, priceTaka: '250' }] }).expect(200);
    expect(bad.body.rows[0].error).toBe('compare-at price must be higher than price');
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.bulk_price_import' } })).toBe(1);
  });

  it('rejects the whole file when any row is bad: nothing is partially imported', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120]);
    const sku = variants[0]!.sku;
    const res = await sa
      .post('/v1/admin/variants/bulk-price')
      .send({
        dryRun: false,
        rows: [{ sku, priceTaka: '200' }, { sku, priceTaka: '210' }, { sku: 'NOPE-1', priceTaka: '10' }, { sku, priceTaka: 'abc' }, { sku, priceTaka: '100', compareAtTaka: '90' }],
      })
      .expect(200);
    expect(res.body.applied).toBe(false);
    expect(res.body.invalid).toBe(4);
    expect(res.body.rows.map((r: { error?: string }) => r.error)).toEqual([undefined, 'duplicate SKU in file', 'unknown SKU', 'duplicate SKU in file', 'duplicate SKU in file']);
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).pricePoisha).toBe(12000);
  });

  it('reports bad amounts and compare-at errors per row', async () => {
    const sa = await superAdmin(h);
    const { variants } = await makeProduct(h, [120, 250]);
    const res = await sa
      .post('/v1/admin/variants/bulk-price')
      .send({ dryRun: true, rows: [{ sku: variants[0]!.sku, priceTaka: 'abc' }, { sku: variants[1]!.sku, priceTaka: '100', compareAtTaka: '90' }] })
      .expect(200);
    expect(res.body.rows.map((r: { error?: string }) => r.error)).toEqual(['invalid amount', 'compare-at price must be higher than price']);
  });

  it('enforces permissions on the server: managers and anonymous callers are refused', async () => {
    const { variants } = await makeProduct(h, [120]);
    const { outlet } = await makeOutletReady(h, [variants[0]!.id], { stock: 1 });
    const manager = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const body = { dryRun: false, rows: [{ sku: variants[0]!.sku, priceTaka: '1' }] };
    await manager.post('/v1/admin/variants/bulk-price').send(body).expect(403);
    await request(h.app.getHttpServer()).post('/v1/admin/variants/bulk-price').send(body).expect((r) => expect([401, 403]).toContain(r.status));
    await request(h.app.getHttpServer()).get('/v1/admin/variants/export.csv').expect(401);
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variants[0]!.id } })).pricePoisha).toBe(12000);
  });
});
