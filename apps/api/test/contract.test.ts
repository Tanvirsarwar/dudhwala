import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAgent, resetDb, startHarness, type Harness } from './support/harness.js';
import { customer, home, makeProduct, makeShop, postOrder, type Shop } from './support/shop.js';

/**
 * The storefront and admin read these fields (apps/web/lib/services/live-orders.ts, apps/web/lib/api.ts, apps/admin).
 * If a field is renamed or dropped here, this test fails before the UI breaks.
 */
let h: Harness;
let shop: Shop;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
  shop = await makeShop(h);
});

const keys = (o: object) => Object.keys(o).sort();
const has = (o: object, expected: string[]) => expect(keys(o)).toEqual(expect.arrayContaining(expected));

describe('API shapes the UI depends on', () => {
  it('catalogue card, detail, cart line, config, outlet', async () => {
    const { product, variant } = await makeProduct(h, { slug: 'shape', stock: 5, outletId: shop.outlet.id });
    const list = (await request(h.app.getHttpServer()).get('/v1/catalog/products').expect(200)).body;
    has(list, ['data', 'page', 'limit', 'total']);
    has(list.data[0], ['id', 'slug', 'nameBn', 'nameEn', 'categorySlug', 'image', 'outerCityStatus', 'fromPricePoisha', 'inStock', 'variants']);
    has(list.data[0].variants[0], ['id', 'labelBn', 'pricePoisha', 'compareAtPoisha', 'availability']);
    const d = (await request(h.app.getHttpServer()).get(`/v1/catalog/products/${product.slug}`).expect(200)).body;
    has(d, ['id', 'slug', 'nameBn', 'category', 'images', 'content', 'variants', 'outerCityStatus']);
    has(d.variants[0], ['id', 'labelBn', 'pricePoisha', 'availability', 'maxQty']);
    const c = await customer(h);
    const cart = (await c.put(`/v1/cart/items/${variant.id}`).send({ quantity: 1 }).expect(200)).body;
    has(cart, ['id', 'lines', 'subtotalPoisha', 'itemCount', 'warnings']);
    has(cart.lines[0], ['variantId', 'productSlug', 'categorySlug', 'outerCityStatus', 'nameBn', 'labelBn', 'unitPricePoisha', 'quantity', 'lineTotalPoisha', 'available', 'maxQty']);
    has((await request(h.app.getHttpServer()).get('/v1/config').expect(200)).body, ['hours', 'bulk', 'deliveryFees', 'paymentMethods']);
    has((await request(h.app.getHttpServer()).get('/v1/outlets').expect(200)).body[0], ['id', 'code', 'nameBn', 'nameEn', 'addressLine', 'hours']);
  });

  it('order (customer view and admin view) and admin lists', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const c = await customer(h);
    const o = (await postOrder(c, home([{ variantId: variant.id, quantity: 1 }])).expect(201)).body;
    has(o, ['id', 'orderNumber', 'createdAt', 'method', 'zone', 'status', 'paymentMethod', 'paymentStatus', 'lines', 'deliveryFeePoisha', 'totalPoisha', 'address', 'contact', 'pickupAt', 'outlet', 'history']);
    has(o.lines[0], ['variantId', 'productSlug', 'nameBn', 'labelBn', 'quantity', 'unitPricePoisha', 'linePoisha']);
    has(o.address, ['name', 'phone', 'line1', 'landmark']);
    const admin = await adminAgent(h);
    const row = (await admin.get('/v1/admin/orders').expect(200)).body;
    has(row, ['data', 'total']);
    has(row.data[0], ['id', 'orderNumber', 'createdAt', 'method', 'zone', 'status', 'totalPoisha', 'itemCount', 'customer', 'outletNameBn']);
    const det = (await admin.get(`/v1/admin/orders/${o.id}`).expect(200)).body;
    has(det, ['next', 'history', 'lines', 'paymentStatus']);
    expect(det.next).toEqual(['PREPARING', 'CANCELLED']);
    has((await admin.get('/v1/admin/summary').expect(200)).body, ['products', 'orders']);
    has((await admin.get('/v1/admin/summary').expect(200)).body.orders, ['total', 'today', 'open', 'byStatus', 'byMethod', 'itemsOrdered', 'knownRevenuePoisha', 'latest']);
    const p = (await admin.get('/v1/admin/products').expect(200)).body;
    has(p.data[0], ['id', 'slug', 'nameBn', 'nameEn', 'categorySlug', 'categoryNameBn', 'active', 'nameVerified', 'outerCityStatus', 'image', 'content', 'variants']);
    has(p.data[0].variants[0], ['id', 'labelBn', 'pricePoisha', 'compareAtPoisha', 'stock', 'maxQty']);
    has((await admin.get('/v1/me').expect(200)).body, ['user', 'role', 'canEdit', 'mfaVerified']);
  });
});
