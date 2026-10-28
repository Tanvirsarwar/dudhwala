import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { resetDb, startHarness, type Harness } from './support/harness.js';
import { bulk, customer, home, idemKey, makeProduct, makeShop, pickup, postOrder, type CustomerAgent, type Shop } from './support/shop.js';

let h: Harness;
let shop: Shop;
let c: CustomerAgent;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z'); // Sunday 12:00 Dhaka
  shop = await makeShop(h);
  c = await customer(h);
});

const line = (variantId: string, quantity = 1) => ({ variantId, quantity });
const stockOf = async (variantId: string, outletId = shop.outlet.id) => h.prisma.inventory.findUniqueOrThrow({ where: { outletId_productVariantId: { outletId, productVariantId: variantId } } });
const inTwoHours = () => new Date(h.clock.now().getTime() + 2 * 3_600_000);

describe('who can order', () => {
  it('requires a signed-in customer', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { default: request } = await import('supertest');
    const res = await request(h.app.getHttpServer()).post('/v1/orders').send(home([line(variant.id)]));
    expect([401, 403]).toContain(res.status);
    expect(await h.prisma.order.count()).toBe(0);
  });

  it('refuses a staff session on the customer order route', async () => {
    const { adminAgent } = await import('./support/harness.js');
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const res = await admin.post('/v1/orders').set('idempotency-key', idemKey()).send(home([line(variant.id)]));
    expect(res.status).toBe(401); // no customer session: staff cookies are ignored on customer routes
  });
});

describe('server-side pricing', () => {
  it('prices from the database and ignores nothing the client sends: price fields are rejected', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 250, stock: 10, outletId: shop.outlet.id });
    const cheat = await postOrder(c, { ...home([line(variant.id, 2)]), lines: [{ ...line(variant.id, 2), unitPricePoisha: 1 }] });
    expect(cheat.status).toBe(400);
    const total = await postOrder(c, { ...home([line(variant.id, 2)]), totalPoisha: 1 });
    expect(total.status).toBe(400);
    const ok = await postOrder(c, home([line(variant.id, 2)]));
    expect(ok.status).toBe(201);
    expect(ok.body.totalPoisha).toBe(2 * 25_000);
    expect(ok.body.lines[0].unitPricePoisha).toBe(25_000);
  });

  it('snapshots the price: later price edits do not change an existing order', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 100, stock: 10, outletId: shop.outlet.id });
    const { body } = await postOrder(c, home([line(variant.id)])).expect(201);
    await h.prisma.productVariant.update({ where: { id: variant.id }, data: { pricePoisha: 99_900 } });
    const again = await c.get(`/v1/orders/${body.id}`).expect(200);
    expect(again.body.totalPoisha).toBe(10_000);
  });

  it('refuses a product with no price set', async () => {
    const { variant } = await makeProduct(h, { priceTaka: null, stock: 10, outletId: shop.outlet.id });
    const res = await postOrder(c, home([line(variant.id)]));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PRICE_NOT_SET');
  });

  it('refuses hidden products and hidden categories', async () => {
    const hidden = await makeProduct(h, { active: false, stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(hidden.variant.id)]))).body.error.code).toBe('PRODUCT_UNAVAILABLE');
    const live = await makeProduct(h, { category: 'cat-x', stock: 5, outletId: shop.outlet.id });
    await h.prisma.category.update({ where: { slug: 'cat-x' }, data: { active: false } });
    expect((await postOrder(c, home([line(live.variant.id)]))).body.error.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('enforces the per-order quantity cap', async () => {
    const { variant } = await makeProduct(h, { stock: 100, maxQty: 3, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(variant.id, 4)]))).status).toBe(400);
    expect((await postOrder(c, home([line(variant.id, 3)]))).status).toBe(201);
  });

  it('rejects duplicate lines and unknown fields', async () => {
    const { variant } = await makeProduct(h, { stock: 100, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(variant.id), line(variant.id)]))).status).toBe(400);
    expect((await postOrder(c, { ...home([line(variant.id)]), coupon: 'FREE' })).status).toBe(400);
  });
});

describe('ordering hours (10:00-22:00 Asia/Dhaka, server clock)', () => {
  const at = (iso: string) => (h.clock.t = new Date(iso));
  it.each([
    ['09:59 Dhaka is closed', '2026-11-01T03:59:00Z', 422],
    ['10:00 Dhaka is open', '2026-11-01T04:00:00Z', 201],
    ['21:59 Dhaka is open', '2026-11-01T15:59:00Z', 201],
    ['22:00 Dhaka is closed', '2026-11-01T16:00:00Z', 422],
    ['midnight Dhaka is closed', '2026-11-01T18:00:00Z', 422],
  ])('%s', async (_n, iso, status) => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    at(iso);
    const res = await postOrder(c, home([line(variant.id)]));
    expect(res.status).toBe(status);
    if (status === 422) {
      expect(res.body.error.code).toBe('ORDERING_CLOSED');
      expect(await h.prisma.order.count()).toBe(0);
      expect((await stockOf(variant.id)).reservedQuantity).toBe(0);
    }
  });

  it('uses the hours the admin saved', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    await h.prisma.setting.create({ data: { key: 'ordering.hours', value: { openMinute: 13 * 60, closeMinute: 18 * 60 } } });
    expect((await postOrder(c, home([line(variant.id)]))).status).toBe(422); // 12:00 now
    h.clock.t = new Date('2026-11-01T08:00:00Z'); // 14:00
    expect((await postOrder(c, home([line(variant.id)]))).status).toBe(201);
  });
});

describe('home delivery zones', () => {
  it('in-city: any product', async () => {
    const { variant } = await makeProduct(h, { category: 'dairy-sweets', stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(variant.id)], 'IN_CITY'))).status).toBe(201);
  });
  it('outer city: only bakery or approved items', async () => {
    const plain = await makeProduct(h, { category: 'dairy-sweets', stock: 5, outletId: shop.outlet.id });
    const bakery = await makeProduct(h, { category: 'bakery', stock: 5, outletId: shop.outlet.id });
    const approved = await makeProduct(h, { category: 'doi-dairy', outer: 'APPROVED', stock: 5, outletId: shop.outlet.id });
    const pending = await makeProduct(h, { category: 'bakery', outer: 'PENDING_VERIFICATION', stock: 5, outletId: shop.outlet.id });
    const disabled = await makeProduct(h, { category: 'bakery', outer: 'DISABLED', stock: 5, outletId: shop.outlet.id });
    const bad = await postOrder(c, home([line(plain.variant.id)], 'OUTER_CITY'));
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('NOT_DELIVERABLE');
    expect(bad.body.error.details[0].variantId).toBe(plain.variant.id);
    expect((await postOrder(c, home([line(pending.variant.id)], 'OUTER_CITY'))).body.error.code).toBe('NOT_DELIVERABLE');
    expect((await postOrder(c, home([line(disabled.variant.id)], 'OUTER_CITY'))).body.error.code).toBe('NOT_DELIVERABLE');
    expect((await postOrder(c, home([line(bakery.variant.id)], 'OUTER_CITY'))).status).toBe(201);
    expect((await postOrder(c, home([line(approved.variant.id)], 'OUTER_CITY'))).status).toBe(201);
  });
  it('one ineligible line blocks the whole order and reserves nothing', async () => {
    const ok = await makeProduct(h, { category: 'bakery', stock: 5, outletId: shop.outlet.id });
    const no = await makeProduct(h, { category: 'dairy-sweets', stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(ok.variant.id), line(no.variant.id)], 'OUTER_CITY'))).status).toBe(422);
    expect((await stockOf(ok.variant.id)).reservedQuantity).toBe(0);
  });
  it('needs a zone and an address', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const noZone = await postOrder(c, { ...home([line(variant.id)]), zone: null });
    expect(noZone.body.error.code).toBe('ZONE_REQUIRED');
    expect((await postOrder(c, { ...home([line(variant.id)]), address: undefined })).status).toBe(400);
    expect((await postOrder(c, { ...home([line(variant.id)]), address: { name: 'a', phone: '01811111111', line1: '' } })).status).toBe(400);
    expect((await postOrder(c, { ...home([line(variant.id)]), address: { name: 'a', phone: '12345', line1: 'x' } })).body.error.code).toBe('VALIDATION_FAILED');
  });
  it('stores the phone in E.164 form', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, { ...home([line(variant.id)]), address: { name: 'রহিম', phone: '+8801811111111', line1: 'x' } }).expect(201);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: body.id } })).contactPhone).toBe('+8801811111111');
  });
  it('is unavailable until a dispatch outlet is configured', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    await h.prisma.setting.delete({ where: { key: 'fulfilment.dispatchOutletId' } });
    const res = await postOrder(c, home([line(variant.id)]));
    expect(res.status).toBe(503);
  });
});

describe('express pickup', () => {
  it('needs at least 60 minutes lead time', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const now = h.clock.now().getTime();
    const tooSoon = await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(now + 59 * 60_000)));
    expect(tooSoon.status).toBe(422);
    expect(tooSoon.body.error.code).toBe('PICKUP_INVALID');
    expect(tooSoon.body.error.details.reason).toBe('too_soon');
    expect((await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(now + 60 * 60_000)))).status).toBe(201);
  });
  it('rejects a time in the past, a garbage time and a time too far ahead', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(h.clock.now().getTime() - 3_600_000)))).body.error.code).toBe('PICKUP_INVALID');
    expect((await postOrder(c, { ...pickup([line(variant.id)], shop.outlet.id, inTwoHours()), pickupAt: 'tomorrow' })).status).toBe(400);
    expect((await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(h.clock.now().getTime() + 8 * 86_400_000)))).body.error.details.reason).toBe('too_far');
  });
  it('respects the outlet opening hours for that weekday', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    // Sunday (0): 10:00-20:00 Dhaka
    await h.prisma.outletHours.create({ data: { outletId: shop.outlet.id, weekday: 0, opensAt: new Date('1970-01-01T10:00:00Z'), closesAt: new Date('1970-01-01T20:00:00Z') } });
    const at = (iso: string) => postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(iso)));
    expect((await at('2026-11-01T15:00:00Z')).body.error.details.reason).toBe('outside_hours'); // 21:00 Dhaka, outlet closed at 20:00
    expect((await at('2026-11-01T13:30:00Z')).status).toBe(201); // 19:30 Dhaka
    // Monday (1) has no hours row: closed all day
    expect((await at('2026-11-02T07:00:00Z')).body.error.details.reason).toBe('outside_hours');
  });
  it('rejects a paused or unknown outlet', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, pickup([line(variant.id)], newId(), inTwoHours()))).status).toBe(400);
    await h.prisma.outlet.update({ where: { id: shop.outlet.id }, data: { status: 'PAUSED' } });
    expect((await postOrder(c, pickup([line(variant.id)], shop.outlet.id, inTwoHours()))).status).toBe(400);
  });
  it('starts as PICKUP_REQUESTED and needs only a contact (no address)', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, pickup([line(variant.id)], shop.outlet.id, inTwoHours())).expect(201);
    expect(body.status).toBe('PICKUP_REQUESTED');
    expect(body.address).toBeNull();
    expect(body.contact.name).toBe('করিম');
  });
});

describe('bulk classification (quantity OR amount)', () => {
  it('a bulk-sized cart cannot use home delivery or pickup', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    const byQty = await postOrder(c, home([line(variant.id, 20)]));
    expect(byQty.status).toBe(422);
    expect(byQty.body.error.code).toBe('BULK_REQUIRED');
    expect((await postOrder(c, pickup([line(variant.id, 20)], shop.outlet.id, inTwoHours()))).body.error.code).toBe('BULK_REQUIRED');
    const exp = await makeProduct(h, { priceTaka: 20_000, stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(exp.variant.id, 1)]))).body.error.code).toBe('BULK_REQUIRED'); // Tk 20,000 reaches the amount threshold
  });
  it('one unit below both thresholds is a normal order, and a normal cart cannot be a bulk order', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(variant.id, 19)]))).status).toBe(201);
    const nb = await postOrder(c, bulk([line(variant.id, 19)]));
    expect(nb.status).toBe(422);
    expect(nb.body.error.code).toBe('NOT_BULK');
    const edge = await makeProduct(h, { priceTaka: 19_999, stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, home([line(edge.variant.id)]))).status).toBe(201); // Tk 19,999 < Tk 20,000
  });
  it('uses the thresholds the admin saved', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    await h.prisma.setting.create({ data: { key: 'bulk.rule', value: { minTotalQuantity: 5, minTotalPoisha: 1_000_000_000, approved: true } } });
    expect((await postOrder(c, home([line(variant.id, 5)]))).body.error.code).toBe('BULK_REQUIRED');
    expect((await postOrder(c, home([line(variant.id, 4)]))).status).toBe(201);
  });
  it('a bulk order cannot be placed while online payment is disabled, and reserves nothing', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    const res = await postOrder(c, bulk([line(variant.id, 20)]));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENTS_DISABLED');
    expect((await stockOf(variant.id)).reservedQuantity).toBe(0);
  });
});

describe('stock: no overselling, reserve / commit / release', () => {
  it('reserves on placement and refuses beyond available stock', async () => {
    const { variant } = await makeProduct(h, { stock: 3, outletId: shop.outlet.id });
    await postOrder(c, home([line(variant.id, 2)])).expect(201);
    expect(await stockOf(variant.id)).toMatchObject({ quantityOnHand: 3, reservedQuantity: 2 });
    const over = await postOrder(c, home([line(variant.id, 2)]));
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('OUT_OF_STOCK');
    expect((await stockOf(variant.id)).reservedQuantity).toBe(2);
  });

  it('never oversells under concurrent orders', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const buyers: CustomerAgent[] = [];
    for (let i = 0; i < 8; i++) buyers.push(await customer(h)); // sequential: OTP codes come from one shared test SMS inbox
    const results = await Promise.all(buyers.map((b) => postOrder(b, home([line(variant.id, 1)]))));
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.status === 409).length).toBe(3);
    const inv = await stockOf(variant.id);
    expect(inv.reservedQuantity).toBe(5);
    expect(inv.quantityOnHand).toBe(5);
  });

  it('a failed multi-line order reserves nothing (all or nothing)', async () => {
    const a = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const b = await makeProduct(h, { stock: 1, outletId: shop.outlet.id });
    const res = await postOrder(c, home([line(a.variant.id, 2), line(b.variant.id, 2)]));
    expect(res.status).toBe(409);
    expect((await stockOf(a.variant.id)).reservedQuantity).toBe(0);
    expect(await h.prisma.order.count()).toBe(0);
  });

  it('a product with no counted stock rows is out of stock', async () => {
    const { variant } = await makeProduct(h, {});
    expect((await postOrder(c, home([line(variant.id)]))).body.error.code).toBe('OUT_OF_STOCK');
  });

  it('stock marked "not counted" is not limited', async () => {
    const { variant } = await makeProduct(h, { stock: 'untracked' });
    expect((await postOrder(c, home([line(variant.id, 7)]))).status).toBe(201);
  });

  it('pickup reserves at the chosen outlet, not the dispatch outlet', async () => {
    const other = await h.prisma.outlet.create({ data: { id: newId(), code: `OTH-${Date.now()}`, nameBn: 'অন্য', addressLine: 'x', status: 'ACTIVE' } });
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    await h.prisma.inventory.create({ data: { id: newId(), outletId: other.id, productVariantId: variant.id, quantityOnHand: 1 } });
    await postOrder(c, pickup([line(variant.id, 1)], other.id, inTwoHours())).expect(201);
    expect((await stockOf(variant.id, other.id)).reservedQuantity).toBe(1);
    expect((await stockOf(variant.id, shop.outlet.id)).reservedQuantity).toBe(0);
    expect((await postOrder(c, pickup([line(variant.id, 1)], other.id, inTwoHours()))).status).toBe(409);
  });
});

describe('idempotency', () => {
  it('a retry with the same key returns the same order and reserves once', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const key = idemKey();
    const first = await postOrder(c, home([line(variant.id, 2)]), key).expect(201);
    const second = await postOrder(c, home([line(variant.id, 2)]), key);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.replayed).toBe(true);
    expect(await h.prisma.order.count()).toBe(1);
    expect((await stockOf(variant.id)).reservedQuantity).toBe(2);
  });
  it('the same key with a different body is refused', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const key = idemKey();
    await postOrder(c, home([line(variant.id, 1)]), key).expect(201);
    const res = await postOrder(c, home([line(variant.id, 2)]), key);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('parallel double-submit creates one order', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const key = idemKey();
    const rs = await Promise.all([1, 2, 3].map(() => postOrder(c, home([line(variant.id, 1)]), key)));
    expect(new Set(rs.filter((r) => [200, 201].includes(r.status)).map((r) => r.body.id)).size).toBe(1);
    expect(await h.prisma.order.count()).toBe(1);
    expect((await stockOf(variant.id)).reservedQuantity).toBe(1);
  });
  it('requires a well-formed Idempotency-Key', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const res = await c.post('/v1/orders').send(home([line(variant.id)]));
    expect(res.status).toBe(400);
    expect((await postOrder(c, home([line(variant.id)]), 'short')).status).toBe(400);
  });
  it('a failed attempt does not burn the key', async () => {
    const { variant } = await makeProduct(h, { stock: 1, outletId: shop.outlet.id });
    const key = idemKey();
    expect((await postOrder(c, home([line(variant.id, 2)]), key)).status).toBe(409);
    await h.prisma.inventory.updateMany({ where: { productVariantId: variant.id }, data: { quantityOnHand: 5 } });
    expect((await postOrder(c, home([line(variant.id, 2)]), key)).status).toBe(201);
  });
});

describe('ownership', () => {
  it('a customer sees only their own orders; others get 404 (same as unknown)', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const mine = await postOrder(c, home([line(variant.id)])).expect(201);
    const other = await customer(h);
    expect((await other.get(`/v1/orders/${mine.body.id}`)).status).toBe(404);
    expect((await other.get(`/v1/orders/${newId()}`)).status).toBe(404);
    expect((await other.get(`/v1/orders/${mine.body.id}/status`)).status).toBe(404);
    expect((await other.get('/v1/orders')).body).toEqual([]);
    expect((await c.get('/v1/orders')).body.map((o: { id: string }) => o.id)).toEqual([mine.body.id]);
    expect((await c.get(`/v1/orders/${mine.body.id}`)).status).toBe(200);
  });
  it('anonymous requests cannot read orders', async () => {
    const { default: request } = await import('supertest');
    expect([401, 403]).toContain((await request(h.app.getHttpServer()).get(`/v1/orders/${newId()}`)).status);
  });
});
