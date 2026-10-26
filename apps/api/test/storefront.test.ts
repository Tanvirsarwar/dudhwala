import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { browser, resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';
import { customer, makeOutletReady, makeProduct, staffAt, superAdmin } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

const anon = async () => {
  const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
  a.set('x-dw-audience', 'customer');
  return a;
};

describe('public catalogue', () => {
  it('lists only ACTIVE products/variants with area-aware availability and no internal fields', async () => {
    const { variants, product } = await makeProduct(h, [120, 220]);
    const draft = await makeProduct(h, [99], 'DRAFT পণ্য');
    await h.prisma.product.update({ where: { id: draft.product.id }, data: { status: 'DRAFT' } });
    await h.prisma.productVariant.update({ where: { id: variants[1]!.id }, data: { status: 'ARCHIVED' } });
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { stock: 3 });
    const otherArea = await h.prisma.area.create({ data: { id: newId(), slug: 'not-served', nameBn: 'দূরে' } });

    const all = await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200);
    expect(all.body.data.map((p: { slug: string }) => p.slug)).toEqual([product.slug]);
    expect(all.body.data[0].variants).toHaveLength(1);
    expect(all.body.data[0].inStock).toBe(true);
    expect(JSON.stringify(all.body)).not.toMatch(/outletId|quantityOnHand|reserved/);
    expect(all.headers['cache-control']).toMatch(/public/);

    const served = await request(h.app.getHttpServer()).get(`/v1/catalog/products?areaId=${areaId}`).expect(200);
    expect(served.body.data[0].inStock).toBe(true);
    const unserved = await request(h.app.getHttpServer()).get(`/v1/catalog/products?areaId=${otherArea.id}`).expect(200);
    expect(unserved.body.data[0].inStock).toBe(false);

    const detail = await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}?areaId=${areaId}`).expect(200);
    expect(detail.body.variants[0]).toMatchObject({ pricePoisha: 12000, availability: 'IN_STOCK', maxQty: 3 });
    expect(detail.body.content).toEqual({});
    await request(h.app.getHttpServer()).get(`/v1/catalog/products/${draft.product.slug}`).expect(404);
    await request(h.app.getHttpServer()).get('/v1/catalog/products/../../etc').expect(404);
  });

  it('searches Bangla and English names, sorts by price and paginates', async () => {
    const a = await makeProduct(h, [300], 'মিষ্টি দই');
    const b = await makeProduct(h, [100], 'ঘি');
    await makeOutletReady(h, [a.variants[0]!.id, b.variants[0]!.id]);
    const bn = await request(h.app.getHttpServer()).get(`/v1/catalog/products?q=${encodeURIComponent('দই')}`).expect(200);
    expect(bn.body.data.map((p: { nameBn: string }) => p.nameBn)).toEqual(['মিষ্টি দই']);
    const en = await request(h.app.getHttpServer()).get('/v1/catalog/products?q=test%20doi').expect(200);
    expect(en.body.total).toBe(2);
    const asc = await request(h.app.getHttpServer()).get('/v1/catalog/products?sort=price_asc').expect(200);
    expect(asc.body.data.map((p: { fromPricePoisha: number }) => p.fromPricePoisha)).toEqual([10000, 30000]);
    const page2 = await request(h.app.getHttpServer()).get('/v1/catalog/products?sort=price_asc&limit=1&page=2').expect(200);
    expect(page2.body.data[0].fromPricePoisha).toBe(30000);
    await request(h.app.getHttpServer()).get('/v1/catalog/products?limit=1000').expect(400);
  });

  it('lists only served areas and checks serviceability', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const lonely = await h.prisma.area.create({ data: { id: newId(), slug: 'lonely', nameBn: 'একা' } });
    const areas = await request(h.app.getHttpServer()).get('/v1/delivery/areas').expect(200);
    expect(areas.body.map((a: { id: string }) => a.id)).toEqual([areaId]);
    expect((await request(h.app.getHttpServer()).get(`/v1/delivery/check?areaId=${lonely.id}`)).body).toEqual({ serviceable: false });
  });
});

describe('cart', () => {
  it('works anonymously, re-prices from the database and merges into the customer cart on login', async () => {
    const { variants } = await makeProduct(h, [120, 200]);
    const { areaId } = await makeOutletReady(h, variants.map((v) => v.id), { stock: 5 });
    const a = await anon();
    let c = await a.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 2 }).expect(200);
    expect(c.body).toMatchObject({ subtotalPoisha: 24000, itemCount: 2 });
    await a.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 2, pricePoisha: 1 }).expect(400); // client prices rejected
    await a.put('/v1/cart/area').send({ areaId }).expect(200);

    await h.prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { pricePoisha: 15000 } });
    c = await a.get('/v1/cart').expect(200);
    expect(c.body.subtotalPoisha).toBe(30000);

    // Log in on the same browser: anonymous cart merges into the customer's existing cart.
    const phone = '01712345670';
    const cust = await customer(h, phone);
    await cust.put(`/v1/cart/items/${variants[1]!.id}`).send({ quantity: 1 }).expect(200);
    h.clock.advance(61_000);
    const r = await a.post('/v1/auth/otp/request').send({ phone }).expect(200);
    await a.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
    const merged = await a.get('/v1/cart').expect(200);
    expect(merged.body.lines.map((l: { quantity: number }) => l.quantity).sort()).toEqual([1, 2]);
    expect(merged.body.areaId).toBe(areaId);
    expect(await h.prisma.cart.count()).toBe(1);
  });

  it('refuses more than the sellable quantity and flags lines that became unavailable', async () => {
    const { variants, product } = await makeProduct(h, [100]);
    await makeOutletReady(h, [variants[0]!.id], { stock: 2 });
    const a = await anon();
    const r = await a.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 3 }).expect(409);
    expect(r.body.error.code).toBe('OUT_OF_STOCK');
    await a.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 2 }).expect(200);
    await h.prisma.product.update({ where: { id: product.id }, data: { status: 'ARCHIVED' } });
    const c = await a.get('/v1/cart').expect(200);
    expect(c.body.warnings).toEqual([{ variantId: variants[0]!.id, code: 'UNAVAILABLE' }]);
    await a.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 0 }).expect(200);
  });

  it('ignores a staff cookie on storefront routes (one browser, two roles)', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { outlet } = await makeOutletReady(h, [variants[0]!.id]);
    const staff = await staffAt(h, 'OUTLET_STAFF', outlet.id);
    // Cart routes always act for the shopper: the staff cookie is ignored, an anonymous cart is used.
    await staff.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const cart = await h.prisma.cart.findFirstOrThrow();
    expect(cart.userId).toBeNull();
    // /me answers per audience: staff by default, customer (none here) with the header.
    expect((await staff.get('/v1/me').expect(200)).body.role).toBe('OUTLET_STAFF');
    await staff.get('/v1/me').set('x-dw-audience', 'customer').expect(401);
  });
});

describe('customer account', () => {
  it('manages profile and address book; other customers get 404', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c1 = await customer(h);
    const c2 = await customer(h);
    await c1.patch('/v1/me/profile').send({ fullName: 'করিম' }).expect(200);
    expect((await c1.get('/v1/me/profile').expect(200)).body.fullName).toBe('করিম');
    const a1 = await c1.post('/v1/me/addresses').send({ recipientName: 'করিম', phone: '০১৭১১১১১১১১', areaId, line1: 'বাড়ি ৫' }).expect(201);
    expect(a1.body).toMatchObject({ isDefault: true, phone: '+8801711111111' });
    const a2 = await c1.post('/v1/me/addresses').send({ recipientName: 'অফিস', phone: '01711111112', areaId, line1: 'অফিস ৭', isDefault: true }).expect(201);
    const list = await c1.get('/v1/me/addresses').expect(200);
    expect(list.body.map((x: { id: string; isDefault: boolean }) => [x.id, x.isDefault])).toEqual([[a2.body.id, true], [a1.body.id, false]]);
    await c2.patch(`/v1/me/addresses/${a1.body.id}`).send({ line1: 'hijack' }).expect(404);
    await c2.delete(`/v1/me/addresses/${a1.body.id}`).expect(404);
    await c1.delete(`/v1/me/addresses/${a1.body.id}`).expect(204);
    await c1.post('/v1/me/addresses').send({ recipientName: 'x', phone: '12345', areaId, line1: 'abc' }).expect(400);
  });
});

describe('content and media', () => {
  it('publishes plain-text pages and shows only approved banners', async () => {
    const sa = await superAdmin(h);
    await sa.put('/v1/admin/pages/about').send({ titleBn: 'আমাদের কথা', bodyBn: 'সিলেটের দুধওয়ালা।', published: false }).expect(200);
    await request(h.app.getHttpServer()).get('/v1/content/pages/about').expect(404);
    await sa.put('/v1/admin/pages/about').send({ titleBn: 'আমাদের কথা', bodyBn: 'সিলেটের দুধওয়ালা।', published: true }).expect(200);
    const page = await request(h.app.getHttpServer()).get('/v1/content/pages/about').expect(200);
    expect(page.body).toMatchObject({ titleBn: 'আমাদের কথা', version: 2 });
    await sa.put('/v1/admin/pages/random-page').send({ titleBn: 'x', bodyBn: 'y', published: true }).expect(404);

    const png = await sharp({ create: { width: 2400, height: 800, channels: 3, background: '#2D308F' } }).png().toBuffer();
    const banner = await sa.post('/v1/admin/banners').field('titleBn', 'নতুন শোরুম').field('altBn', 'জালালাবাদ শোরুম').attach('file', png, 'b.png').expect(201);
    expect((await request(h.app.getHttpServer()).get('/v1/content/home').expect(200)).body.banners).toEqual([]);
    await sa.patch(`/v1/admin/banners/${banner.body.id}`).send({ active: true }).expect(200);
    const home = await request(h.app.getHttpServer()).get('/v1/content/home').expect(200);
    expect(home.body.banners).toHaveLength(1);
    const img = await request(h.app.getHttpServer()).get(new URL(home.body.banners[0].imageUrl).pathname).expect(200);
    expect(img.headers['content-type']).toBe('image/webp');
    const meta = await sharp(img.body as Buffer).metadata();
    expect(meta.width).toBe(1600);
    expect(home.body.pages).toEqual([{ slug: 'about', titleBn: 'আমাদের কথা', titleEn: null }]);
  });

  it('rejects non-images, SVG and oversize uploads; strips metadata', async () => {
    const sa = await superAdmin(h);
    const { product } = await makeProduct(h, [100]);
    await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'x').attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg').expect(400);
    await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'x').attach('file', Buffer.from('not an image at all'), 'x.jpg').expect(400);
    await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'x').attach('file', Buffer.alloc(6 * 1024 * 1024, 1), 'big.jpg').expect(413);
    const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fff' } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).toBuffer();
    const up = await sa.post(`/v1/admin/products/${product.id}/images`).field('altBn', 'দই').attach('file', jpg, 'a.jpg').expect(201);
    expect(up.body).toMatchObject({ width: 300, height: 200 });
    const stored = await request(h.app.getHttpServer()).get(new URL(up.body.url).pathname).expect(200);
    expect((await sharp(stored.body as Buffer).metadata()).exif).toBeUndefined();
    await request(h.app.getHttpServer()).get('/v1/media/products/..%2F..%2Fpackage.json').expect(404);
  });

  it('collections filter the catalogue', async () => {
    const sa = await superAdmin(h);
    const a = await makeProduct(h, [100], 'ক');
    await makeProduct(h, [200], 'খ');
    await sa.post('/v1/admin/collections').send({ slug: 'featured', titleBn: 'বিশেষ', active: true, productIds: [a.product.id] }).expect(201);
    const r = await request(h.app.getHttpServer()).get('/v1/catalog/products?collection=featured').expect(200);
    expect(r.body.data.map((p: { nameBn: string }) => p.nameBn)).toEqual(['ক']);
  });
});
