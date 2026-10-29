import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { MediaStorage } from '../src/media/media.js';
import { adminAgent, managerAgent, resetDb, startHarness, type Harness } from './support/harness.js';
import { customer, home, makeProduct, makeShop, postOrder, type Shop } from './support/shop.js';
import request from 'supertest';

class MemoryStorage extends MediaStorage {
  files = new Map<string, Buffer>();
  async put(key: string, body: Buffer) {
    this.files.set(key, body);
  }
  baseUrl() {
    return 'https://media.test';
  }
}

let h: Harness;
let shop: Shop;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
  shop = await makeShop(h);
});

const png = (w = 40, h2 = 30) => sharp({ create: { width: w, height: h2, channels: 3, background: '#cc8844' } }).png().toBuffer();
const b64 = (b: Buffer) => b.toString('base64');

describe('public catalogue', () => {
  it('shows only active products in active categories; hidden ones are 404', async () => {
    const live = await makeProduct(h, { slug: 'live-1', stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'hidden-1', active: false, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'incat-1', category: 'off-cat', stock: 5, outletId: shop.outlet.id });
    await h.prisma.category.update({ where: { slug: 'off-cat' }, data: { active: false } });
    const list = await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200);
    expect(list.body.data.map((p: { slug: string }) => p.slug)).toEqual(['live-1']);
    expect(list.body.total).toBe(1);
    await request(h.app.getHttpServer()).get('/v1/catalog/products/live-1').expect(200);
    expect((await request(h.app.getHttpServer()).get('/v1/catalog/products/hidden-1')).status).toBe(404);
    expect((await request(h.app.getHttpServer()).get('/v1/catalog/products/incat-1')).status).toBe(404);
    expect((await request(h.app.getHttpServer()).get('/v1/catalog/categories').expect(200)).body.map((c: { slug: string }) => c.slug)).toEqual(['doi-dairy']);
    expect(live.product.slug).toBe('live-1');
  });

  it('exposes availability but never stock counts, and null price for unpriced items', async () => {
    await makeProduct(h, { slug: 'priced', priceTaka: 120, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'unpriced', priceTaka: null, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'soldout', stock: 0, outletId: shop.outlet.id });
    const res = (await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200)).body.data as { slug: string; inStock: boolean; fromPricePoisha: number | null; variants: { pricePoisha: number | null; availability: string }[] }[];
    const by = (s: string) => res.find((p) => p.slug === s) as (typeof res)[number];
    expect(by('priced').variants[0]).toMatchObject({ pricePoisha: 12_000, availability: 'IN_STOCK' });
    expect(by('unpriced').variants[0]?.pricePoisha).toBeNull();
    expect(by('unpriced').fromPricePoisha).toBeNull();
    expect(by('soldout').variants[0]?.availability).toBe('OUT_OF_STOCK');
    expect(JSON.stringify(res)).not.toMatch(/quantityOnHand|reserved|stockByOutlet/);
    const detail = (await request(h.app.getHttpServer()).get('/v1/catalog/products/priced').expect(200)).body;
    expect(JSON.stringify(detail)).not.toMatch(/quantityOnHand|reserved|stockByOutlet/);
  });

  it('filters, searches and sorts', async () => {
    await makeProduct(h, { slug: 'a', category: 'bakery', priceTaka: 300, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'b', category: 'doi-dairy', priceTaka: 100, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'c', category: 'doi-dairy', priceTaka: null, stock: 5, outletId: shop.outlet.id });
    const get = async (qs: string) => ((await request(h.app.getHttpServer()).get(`/v1/catalog/products?${qs}`).expect(200)).body.data as { slug: string }[]).map((p) => p.slug);
    expect(await get('category=bakery')).toEqual(['a']);
    expect(await get('sort=price_asc')).toEqual(['b', 'a', 'c']); // unknown prices last
    expect(await get('sort=price_desc')).toEqual(['a', 'b', 'c']);
    expect((await get('q=টেস্ট')).length).toBe(3);
    expect(await get('q=zzzz')).toEqual([]);
    expect((await request(h.app.getHttpServer()).get('/v1/catalog/products?limit=1000')).status).toBe(400);
  });

  it('a product with no counted stock rows shows as out of stock; an uncounted one as in stock', async () => {
    await makeProduct(h, { slug: 'none' });
    await makeProduct(h, { slug: 'free', stock: 'untracked' });
    const res = (await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200)).body.data as { slug: string; inStock: boolean; fromPricePoisha: number | null; variants: { pricePoisha: number | null; availability: string }[] }[];
    expect(res.find((p) => p.slug === 'none')!.inStock).toBe(false);
    expect(res.find((p) => p.slug === 'free')!.inStock).toBe(true);
  });
});

describe('admin catalogue', () => {
  it('creates a product hidden, with one blank option, and audits it', async () => {
    const admin = await adminAgent(h);
    const cat = await h.prisma.category.create({ data: { id: newId(), slug: 'sweets', nameBn: 'মিষ্টি', nameEn: 'Sweets' } });
    const res = await admin.post('/v1/admin/products').send({ nameBn: 'নতুন', nameEn: 'New', categorySlug: cat.slug }).expect(201);
    expect(res.body).toMatchObject({ active: false, nameVerified: true, categorySlug: 'sweets' });
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.variants[0].pricePoisha).toBeNull();
    expect(await h.prisma.auditLog.count({ where: { action: 'product.create', entityId: res.body.id } })).toBe(1);
  });

  it('edits names, price, flags and content; every change is audited with before/after', async () => {
    const admin = await adminAgent(h);
    const { product, variant } = await makeProduct(h, { priceTaka: 100, stock: 5, outletId: shop.outlet.id, active: false });
    const res = await admin
      .patch(`/v1/admin/products/${product.id}`)
      .send({
        nameBn: 'রসমালাই',
        active: true,
        outerCityStatus: 'approved',
        content: { descriptionBn: 'বিবরণ', storageBn: '' },
        variants: [{ id: variant.id, labelBn: '৫০০ গ্রাম', pricePoisha: 45_000, compareAtPoisha: 50_000, maxQty: 10, stock: 5 }],
      })
      .expect(200);
    expect(res.body).toMatchObject({ nameBn: 'রসমালাই', active: true, outerCityStatus: 'approved' });
    expect(res.body.content).toMatchObject({ descriptionBn: 'বিবরণ', storageBn: null });
    expect(res.body.variants[0]).toMatchObject({ labelBn: '৫০০ গ্রাম', pricePoisha: 45_000, compareAtPoisha: 50_000, maxQty: 10 });
    const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'product.update', entityId: product.id } });
    expect((log.before as { variants: { pricePoisha: number }[] }).variants[0]!.pricePoisha).toBe(10_000);
    expect((log.after as { variants: { pricePoisha: number }[] }).variants[0]!.pricePoisha).toBe(45_000);
    const pub = await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}`).expect(200);
    expect(pub.body.variants[0].pricePoisha).toBe(45_000);
  });

  it('validates input: old price above price, whole numbers, lengths, unknown fields, unknown category', async () => {
    const admin = await adminAgent(h);
    const { product, variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const patch = (b: object) => admin.patch(`/v1/admin/products/${product.id}`).send(b);
    expect((await patch({ variants: [{ id: variant.id, pricePoisha: 5000, compareAtPoisha: 4000 }] })).status).toBe(400);
    expect((await patch({ variants: [{ id: variant.id, compareAtPoisha: 4000 }] })).status).toBe(400);
    expect((await patch({ variants: [{ id: variant.id, pricePoisha: 12.5 }] })).status).toBe(400);
    expect((await patch({ variants: [{ id: variant.id, pricePoisha: -5 }] })).status).toBe(400);
    expect((await patch({ variants: [{ id: variant.id, pricePoisha: 0 }] })).status).toBe(400);
    expect((await patch({ variants: [] })).status).toBe(400);
    expect((await patch({ nameBn: 'x'.repeat(121) })).status).toBe(400);
    expect((await patch({ nameBn: '   ' })).status).toBe(400);
    expect((await patch({ slug: 'hacked' })).status).toBe(400);
    expect((await patch({ categorySlug: 'nope' })).status).toBe(400);
    expect((await patch({ outerCityStatus: 'maybe' })).status).toBe(400);
    expect((await admin.patch(`/v1/admin/products/${newId()}`).send({ nameBn: 'x' })).status).toBe(404);
    expect((await admin.patch('/v1/admin/products/not-a-uuid').send({ nameBn: 'x' })).status).toBe(400);
  });

  it('stock typed in the admin is stored per outlet with a ledger row; null means not counted', async () => {
    const admin = await adminAgent(h);
    const { product, variant } = await makeProduct(h, {});
    const set = (stock: number | null) => admin.patch(`/v1/admin/products/${product.id}`).send({ variants: [{ id: variant.id, pricePoisha: 10_000, stock }] });
    const a = await set(12).expect(200);
    expect(a.body.variants[0].stock).toBe(12);
    expect((await h.prisma.inventory.findFirstOrThrow({ where: { productVariantId: variant.id, outletId: shop.outlet.id } })).quantityOnHand).toBe(12);
    expect(await h.prisma.stockMovement.count({ where: { productVariantId: variant.id, type: 'SET' } })).toBe(1);
    await set(12).expect(200); // unchanged -> no new movement
    expect(await h.prisma.stockMovement.count({ where: { productVariantId: variant.id } })).toBe(1);
    const off = await set(null).expect(200);
    expect(off.body.variants[0].stock).toBeNull();
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).trackStock).toBe(false);
  });

  it('stock cannot be set below what open orders hold', async () => {
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const c = await customer(h);
    await postOrder(c, home([{ variantId: variant.id, quantity: 4 }])).expect(201);
    const r = await admin.post('/v1/admin/inventory').send({ outletId: shop.outlet.id, variantId: variant.id, quantity: 3 });
    expect(r.status).toBe(409);
    await admin.post('/v1/admin/inventory').send({ outletId: shop.outlet.id, variantId: variant.id, quantity: 4 }).expect(200);
    expect((await admin.post('/v1/admin/inventory').send({ outletId: shop.outlet.id, variantId: variant.id, quantity: -1 })).status).toBe(400);
  });

  it('refuses to remove an option that has orders; allows removing an unused one', async () => {
    const admin = await adminAgent(h);
    const { product, variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const extra = (await admin.patch(`/v1/admin/products/${product.id}`).send({ variants: [{ id: variant.id, pricePoisha: 10_000, stock: 5 }, { labelBn: 'বড়', pricePoisha: 20_000 }] }).expect(200)).body.variants;
    expect(extra).toHaveLength(2);
    const c = await customer(h);
    await postOrder(c, home([{ variantId: variant.id, quantity: 1 }])).expect(201);
    const newId2 = extra.find((v: { id: string }) => v.id !== variant.id).id as string;
    const drop = await admin.patch(`/v1/admin/products/${product.id}`).send({ variants: [{ id: newId2, pricePoisha: 20_000 }] });
    expect(drop.status).toBe(409);
    const ok = await admin.patch(`/v1/admin/products/${product.id}`).send({ variants: [{ id: variant.id, pricePoisha: 10_000 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.variants).toHaveLength(1);
  });

  it('manages categories', async () => {
    const admin = await adminAgent(h);
    const c = (await admin.post('/v1/admin/categories').send({ nameBn: 'নতুন', nameEn: 'New' }).expect(201)).body;
    expect((await admin.patch(`/v1/admin/categories/${c.id}`).send({ active: false, nameEn: 'Renamed' }).expect(200)).body).toMatchObject({ active: false, nameEn: 'Renamed' });
    expect((await admin.patch(`/v1/admin/categories/${c.id}`).send({ nameEn: '' })).status).toBe(400);
    expect((await admin.get('/v1/admin/categories').expect(200)).body[0]).toHaveProperty('productCount');
  });

  it('lists with the same filters the admin screens use', async () => {
    const admin = await adminAgent(h);
    await makeProduct(h, { slug: 'p-priced', priceTaka: 10, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'p-noprice', priceTaka: null, stock: 5, outletId: shop.outlet.id });
    await makeProduct(h, { slug: 'p-hidden', active: false, stock: 5, outletId: shop.outlet.id });
    const slugs = async (qs: string) => ((await admin.get(`/v1/admin/products?${qs}`).expect(200)).body.data as { slug: string }[]).map((p) => p.slug).sort();
    expect(await slugs('status=noprice')).toEqual(['p-noprice']);
    expect(await slugs('status=hidden')).toEqual(['p-hidden']);
    expect(await slugs('status=active')).toEqual(['p-noprice', 'p-priced']);
    expect(await slugs('status=noimage')).toHaveLength(3);
    expect(await slugs('q=p-pri')).toEqual(['p-priced']);
  });
});

describe('manager is read-only on the catalogue', () => {
  it('can read products and categories; every write is 403 READ_ONLY and changes nothing', async () => {
    const mgr = await managerAgent(h);
    const { product, variant } = await makeProduct(h, { priceTaka: 100, stock: 5, outletId: shop.outlet.id });
    await mgr.get('/v1/admin/products').expect(200);
    await mgr.get(`/v1/admin/products/${product.id}`).expect(200);
    await mgr.get('/v1/admin/categories').expect(200);
    await mgr.get('/v1/admin/config').expect(200);
    const attempts = [
      mgr.patch(`/v1/admin/products/${product.id}`).send({ variants: [{ id: variant.id, pricePoisha: 1 }] }),
      mgr.post('/v1/admin/products').send({ nameBn: 'x', nameEn: 'x', categorySlug: 'doi-dairy' }),
      mgr.post('/v1/admin/categories').send({ nameBn: 'x', nameEn: 'x' }),
      mgr.post(`/v1/admin/products/${product.id}/image`).send({ dataBase64: 'AAAA' }),
      mgr.delete(`/v1/admin/products/${product.id}/image`),
      mgr.post('/v1/admin/inventory').send({ outletId: shop.outlet.id, variantId: variant.id, quantity: 99 }),
      mgr.put('/v1/admin/config').send({ hours: { open: '09:00', close: '23:00' }, bulk: { minTotalQuantity: 1, minTotalTaka: 1 } }),
      mgr.put('/v1/admin/fulfilment-outlets').send({ dispatchOutletId: null }),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('READ_ONLY');
    }
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).pricePoisha).toBe(10_000);
    expect(await h.prisma.auditLog.count({ where: { action: { startsWith: 'product.' } } })).toBe(0);
  });
  it('anonymous and customer callers cannot reach admin routes at all', async () => {
    const anon = request(h.app.getHttpServer());
    expect((await anon.get('/v1/admin/products')).status).toBe(401);
    const c = await customer(h);
    expect((await c.get('/v1/admin/products')).status).toBe(403);
    expect((await c.get('/v1/admin/orders')).status).toBe(403);
    expect((await c.get('/v1/admin/audit')).status).toBe(403);
  });
});

describe('product images', () => {
  let storage: MemoryStorage;
  beforeAll(async () => {
    await h.close();
    storage = new MemoryStorage();
    h = await startHarness();
    (h.app.get(MediaStorage) as unknown as { put: MediaStorage['put'] }).put = storage.put.bind(storage);
  });

  it('accepts a real image, re-encodes it to WebP, and serves it on the product', async () => {
    const admin = await adminAgent(h);
    const { product } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const res = await admin.post(`/v1/admin/products/${product.id}/image`).send({ dataBase64: b64(await png(2000, 1000)) }).expect(200);
    expect(res.body.image).toMatch(/\/products\/[0-9a-f-]+\.webp\?v=1$/);
    const row = await h.prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.imageKey).toMatch(/^products\/.+\.webp$/);
    expect(row.imageWidth).toBe(1600); // downscaled
    expect(storage.files.get(row.imageKey!)!.subarray(8, 12).toString()).toBe('WEBP');
    const pub = await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}`).expect(200);
    expect(pub.body.images[0].url).toContain(row.imageKey);
  });

  it('rejects non-images, SVG, huge files and empty uploads; nothing is stored', async () => {
    const admin = await adminAgent(h);
    const { product } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const url = `/v1/admin/products/${product.id}/image`;
    const before = storage.files.size;
    expect((await admin.post(url).send({ dataBase64: b64(Buffer.from('<?php system($_GET[1]); ?>')) })).status).toBe(400);
    expect((await admin.post(url).send({ dataBase64: b64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')) })).status).toBe(400);
    expect((await admin.post(url).send({ dataBase64: b64(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(100)])) })).status).toBe(400);
    expect((await admin.post(url).send({ dataBase64: '' })).status).toBe(400);
    expect((await admin.post(url).send({ dataBase64: b64(Buffer.alloc(5.5 * 1024 * 1024, 1)) })).status).toBe(400); // over the 5 MB image limit
    expect((await admin.post(url).send({ dataBase64: b64(Buffer.alloc(7 * 1024 * 1024, 1)) })).status).toBe(413); // over the request size limit
    expect((await admin.post(url).send({})).status).toBe(400);
    expect(storage.files.size).toBe(before);
    expect((await h.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imageKey).toBeNull();
  });

  it('strips metadata and removes the image on request', async () => {
    const admin = await adminAgent(h);
    const { product } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const withExif = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-owner' } } }).toBuffer();
    await admin.post(`/v1/admin/products/${product.id}/image`).send({ dataBase64: b64(withExif) }).expect(200);
    const key = (await h.prisma.product.findUniqueOrThrow({ where: { id: product.id } })).imageKey!;
    expect(storage.files.get(key)!.toString('latin1')).not.toContain('secret-owner');
    const del = await admin.delete(`/v1/admin/products/${product.id}/image`).expect(200);
    expect(del.body.image).toBeNull();
    expect(await h.prisma.auditLog.count({ where: { action: 'product.image_remove' } })).toBe(1);
  });
});
