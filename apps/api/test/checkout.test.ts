import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { resetDb, startHarness, type Harness } from './support/harness.js';
import { address, checkoutFlow, customer, idemKey, makeOutletReady, makeProduct } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

describe('checkout', () => {
  it('places a COD order: totals from the DB, snapshots, stock reserved, slot booked, cart cleared, SMS queued', async () => {
    const { variants } = await makeProduct(h, [120]);
    const { areaId, outlet } = await makeOutletReady(h, [variants[0]!.id], { stock: 5, feeTaka: 60 });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 2 }).expect(200);
    const { quote, price, placed } = await checkoutFlow(c, areaId, 'COD');
    expect(quote.slots.length).toBeGreaterThan(0);
    expect(price).toMatchObject({ subtotalPoisha: 24000, deliveryFeePoisha: 6000, totalPoisha: 30000, codEligible: true });
    expect(price.paymentMethods).toEqual(['ONLINE', 'COD']);
    expect(placed).toMatchObject({ status: 'PLACED', paymentStatus: 'UNPAID', next: 'CONFIRMATION' });
    expect(placed.orderNumber).toMatch(/^DW-\d{6}-[2-9A-Z]{6}$/);

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { items: true, delivery: { include: { cod: true } } } });
    expect(order).toMatchObject({ outletId: outlet.id, subtotalPoisha: 24000, deliveryFeePoisha: 6000, totalPoisha: 30000, shipName: 'রহিম' });
    expect(order.items[0]).toMatchObject({ productNameBn: 'TEST দই', unitPricePoisha: 12000, quantity: 2 });
    expect(order.delivery?.cod).toMatchObject({ expectedPoisha: 30000, status: 'PENDING' });
    const inv = await h.prisma.inventory.findFirstOrThrow({ where: { outletId: outlet.id } });
    expect([inv.quantityOnHand, inv.reservedQuantity]).toEqual([5, 2]);
    expect((await h.prisma.deliverySlot.findUniqueOrThrow({ where: { id: order.deliverySlotId } })).bookedCount).toBe(1);
    expect((await c.get('/v1/cart').expect(200)).body.itemCount).toBe(0);
    expect(await h.prisma.notificationRecord.count({ where: { orderId: order.id, template: 'order.placed' } })).toBe(1);

    // A later price change does not touch the order.
    await h.prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { pricePoisha: 99_900 } });
    const mine = await c.get(`/v1/me/orders/${order.id}`).expect(200);
    expect(mine.body.items[0].unitPricePoisha).toBe(12000);
  });

  it('is idempotent: same key returns the same order; same key + different body is rejected', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
    const key = idemKey();
    const body = { address: address(areaId), slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', quoteHash: pr.body.quoteHash, acceptedPolicyVersion: 'v1' };
    const [a, b] = await Promise.all([c.post('/v1/checkout/orders').set('idempotency-key', key).send(body), c.post('/v1/checkout/orders').set('idempotency-key', key).send(body)]);
    for (const r of [a, b]) expect([200, 201]).toContain(r.status);
    expect(a.body.orderId).toBe(b.body.orderId);
    expect(await h.prisma.order.count()).toBe(1);
    const again = await c.post('/v1/checkout/orders').set('idempotency-key', key).send(body);
    expect(again.body).toMatchObject({ orderId: a.body.orderId, replayed: true });
    const changed = await c.post('/v1/checkout/orders').set('idempotency-key', key).send({ ...body, acceptedPolicyVersion: 'v2' }).expect(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    await c.post('/v1/checkout/orders').send(body).expect(400); // key required
  });

  it('never oversells: 8 customers race for 3 units', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId, outlet } = await makeOutletReady(h, [variants[0]!.id], { stock: 3, capacity: 50 });
    const customers = [];
    for (let i = 0; i < 8; i++) {
      const c = await customer(h);
      await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
      customers.push(c);
    }
    const prepared = await Promise.all(
      customers.map(async (c) => {
        const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
        const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
        return { c, slotKey: q.body.slots[0].slotKey as string, quoteHash: pr.body.quoteHash as string };
      }),
    );
    const results = await Promise.all(
      prepared.map(({ c, slotKey, quoteHash }) =>
        c.post('/v1/checkout/orders').set('idempotency-key', idemKey()).send({ address: address(areaId), slotKey, paymentMethod: 'COD', quoteHash, acceptedPolicyVersion: 'v1' }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    for (const r of results.filter((x) => x.status !== 201)) expect(['OUT_OF_STOCK', 'SLOT_FULL']).toContain(r.body.error.code);
    const inv = await h.prisma.inventory.findFirstOrThrow({ where: { outletId: outlet.id } });
    expect(inv.reservedQuantity).toBe(3);
  });

  it('never overbooks a slot: capacity 2, 6 orders for the same window', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { stock: 100, capacity: 2 });
    const cs = [];
    for (let i = 0; i < 6; i++) {
      const c = await customer(h);
      await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
      const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
      const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
      cs.push({ c, slotKey: q.body.slots[0].slotKey as string, quoteHash: pr.body.quoteHash as string });
    }
    const results = await Promise.all(
      cs.map(({ c, slotKey, quoteHash }) => c.post('/v1/checkout/orders').set('idempotency-key', idemKey()).send({ address: address(areaId), slotKey, paymentMethod: 'COD', quoteHash, acceptedPolicyVersion: 'v1' })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_FULL')).toBe(true);
    const slot = await h.prisma.deliverySlot.findFirstOrThrow({ where: { bookedCount: { gt: 0 } } });
    expect(slot.bookedCount).toBe(2);
    // A full slot is no longer offered.
    const late = await customer(h);
    await late.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await late.post('/v1/checkout/quote').send({ areaId }).expect(200);
    expect(q.body.slots.map((s: { slotKey: string }) => s.slotKey)).not.toContain(cs[0]!.slotKey);
  });

  it('falls over to the next outlet when the preferred one runs out (no split orders)', async () => {
    const { variants } = await makeProduct(h, [100]);
    const first = await makeOutletReady(h, [variants[0]!.id], { stock: 1, priority: 1, outletCode: 'FIRST' });
    const second = await makeOutletReady(h, [variants[0]!.id], { stock: 5, priority: 2, outletCode: 'SECOND', areaId: first.areaId, zoneId: first.zoneId });
    const c1 = await customer(h);
    await c1.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const o1 = await checkoutFlow(c1, first.areaId, 'COD');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o1.placed.orderId } })).outletId).toBe(first.outlet.id);
    const c2 = await customer(h);
    await c2.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const o2 = await checkoutFlow(c2, first.areaId, 'COD');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o2.placed.orderId } })).outletId).toBe(second.outlet.id);
  });

  it('explains when no single outlet can fulfil the whole cart', async () => {
    const a = await makeProduct(h, [100], 'ক');
    const b = await makeProduct(h, [100], 'খ');
    const o1 = await makeOutletReady(h, [a.variants[0]!.id]);
    await makeOutletReady(h, [b.variants[0]!.id], { areaId: o1.areaId, zoneId: o1.zoneId });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${a.variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    await c.put(`/v1/cart/items/${b.variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await c.post('/v1/checkout/quote').send({ areaId: o1.areaId }).expect(200);
    expect(q.body).toMatchObject({ noSingleOutlet: true, reason: 'NO_SINGLE_OUTLET', slots: [] });
  });

  it('refuses unserviceable areas and validates minimum order and COD limits', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { minOrderTaka: 150, codMaxTaka: 200 });
    const elsewhere = await h.prisma.area.create({ data: { id: newId(), slug: 'elsewhere', nameBn: 'অন্য' } });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const unserved = await c.post('/v1/checkout/quote').send({ areaId: elsewhere.id }).expect(200);
    expect(unserved.body).toMatchObject({ serviceable: false, reason: 'AREA_NOT_SERVICEABLE' });
    const small = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    expect(small.body).toMatchObject({ reason: 'MIN_ORDER_NOT_MET', minOrderPoisha: 15000 });
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 3 }).expect(200);
    const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
    expect(pr.body).toMatchObject({ totalPoisha: 36000, codEligible: false, paymentMethods: ['ONLINE'] });
    const r = await c
      .post('/v1/checkout/orders')
      .set('idempotency-key', idemKey())
      .send({ address: address(areaId), slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', quoteHash: pr.body.quoteHash, acceptedPolicyVersion: 'v1' })
      .expect(422);
    expect(r.body.error.code).toBe('COD_NOT_ELIGIBLE');
    expect(await h.prisma.order.count()).toBe(0); // nothing reserved after the rollback
    expect((await h.prisma.inventory.findFirstOrThrow()).reservedQuantity).toBe(0);
  });

  it('detects price changes between quote and placement', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
    await h.prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { pricePoisha: 11000 } });
    const r = await c
      .post('/v1/checkout/orders')
      .set('idempotency-key', idemKey())
      .send({ address: address(areaId), slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', quoteHash: pr.body.quoteHash, acceptedPolicyVersion: 'v1' })
      .expect(409);
    expect(r.body.error).toMatchObject({ code: 'PRICE_CHANGED', details: { totalPoisha: 17000 } });
    const forged = await c
      .post('/v1/checkout/orders')
      .set('idempotency-key', idemKey())
      .send({ address: address(areaId), slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', quoteHash: '0'.repeat(64), acceptedPolicyVersion: 'v1' })
      .expect(409);
    expect(forged.body.error.code).toBe('PRICE_CHANGED');
  });

  it('respects slot cut-off times', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const before = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    h.clock.advance(3 * 3_600_000 + 1); // 13:00 Dhaka passed → the 14:00 slot's cut-off passed
    const after = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    expect(after.body.slots.length).toBe(before.body.slots.length - 1);
    expect(after.body.slots[0].slotKey).not.toBe(before.body.slots[0].slotKey);
  });

  it('applies coupons with usage limits and per-customer limits', async () => {
    const { variants } = await makeProduct(h, [200]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { stock: 50, capacity: 50 });
    await h.prisma.coupon.create({ data: { id: newId(), code: 'EID10', type: 'PERCENT', value: 1000, usageLimitTotal: 1, usageLimitPerCustomer: 1, active: true } });
    const c1 = await customer(h);
    await c1.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const o = await checkoutFlow(c1, areaId, 'COD', { coupon: 'EID10' });
    expect(o.price).toMatchObject({ discountPoisha: 2000, totalPoisha: 24000 });
    const c2 = await customer(h);
    await c2.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await c2.post('/v1/checkout/quote').send({ areaId }).expect(200);
    const used = await c2.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', couponCode: 'EID10' }).expect(409);
    expect(used.body.error).toMatchObject({ code: 'COUPON_INVALID', details: { reason: 'USAGE_LIMIT_REACHED' } });
    // Cancelling the order gives the use back.
    await c1.post(`/v1/me/orders/${o.placed.orderId}/cancel`).send({ reason: 'changed my mind' }).expect(200);
    await c2.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD', couponCode: 'EID10' }).expect(200);
  });

  it('customer cancellation releases stock, slot and notifies; other customers cannot see or cancel', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId, outlet } = await makeOutletReady(h, [variants[0]!.id], { stock: 4 });
    const c = await customer(h);
    const other = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 2 }).expect(200);
    const { placed } = await checkoutFlow(c, areaId, 'COD');
    await other.get(`/v1/me/orders/${placed.orderId}`).expect(404);
    await other.post(`/v1/me/orders/${placed.orderId}/cancel`).send({ reason: 'not mine' }).expect(404);
    await c.post(`/v1/me/orders/${placed.orderId}/cancel`).send({ reason: 'ordered by mistake' }).expect(200);
    const inv = await h.prisma.inventory.findFirstOrThrow({ where: { outletId: outlet.id } });
    expect(inv.reservedQuantity).toBe(0);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect((await h.prisma.deliverySlot.findUniqueOrThrow({ where: { id: order.deliverySlotId } })).bookedCount).toBe(0);
    expect(order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'CANCELLED' });
    await c.post(`/v1/me/orders/${placed.orderId}/cancel`).send({ reason: 'again' }).expect(409);
    const list = await c.get('/v1/me/orders').expect(200);
    expect(list.body).toHaveLength(1);
    expect((await other.get('/v1/me/orders').expect(200)).body).toHaveLength(0);
  });

  it('reorder adds still-available items at current prices', async () => {
    const { variants } = await makeProduct(h, [100, 200]);
    const { areaId } = await makeOutletReady(h, variants.map((v) => v.id));
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    await c.put(`/v1/cart/items/${variants[1]!.id}`).send({ quantity: 1 }).expect(200);
    const { placed } = await checkoutFlow(c, areaId, 'COD');
    await h.prisma.productVariant.update({ where: { id: variants[0]!.id }, data: { pricePoisha: 15000 } });
    await h.prisma.productVariant.update({ where: { id: variants[1]!.id }, data: { status: 'ARCHIVED' } });
    const r = await c.post(`/v1/me/orders/${placed.orderId}/reorder`).expect(200);
    expect(r.body.cart.lines.map((l: { unitPricePoisha: number }) => l.unitPricePoisha)).toEqual([15000]);
    expect(r.body.skipped).toHaveLength(1);
  });

  it('requires a customer session for checkout', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const { browser } = await import('./support/harness.js');
    const a = await browser(h.app);
    await a.post('/v1/checkout/quote').send({ areaId }).expect(401);
  });
});
