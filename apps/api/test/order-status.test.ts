import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAgent, managerAgent, resetDb, startHarness, type Harness } from './support/harness.js';
import { customer, home, makeProduct, makeShop, pickup, postOrder, type CustomerAgent, type Shop } from './support/shop.js';

let h: Harness;
let shop: Shop;
let c: CustomerAgent;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
  shop = await makeShop(h);
  c = await customer(h);
});

const line = (variantId: string, quantity = 1) => ({ variantId, quantity });
const inv = (variantId: string) => h.prisma.inventory.findUniqueOrThrow({ where: { outletId_productVariantId: { outletId: shop.outlet.id, productVariantId: variantId } } });
async function placeHome(qty = 2) {
  const { variant } = await makeProduct(h, { stock: 10, outletId: shop.outlet.id });
  const { body } = await postOrder(c, home([line(variant.id, qty)])).expect(201);
  return { variant, order: body };
}

describe('status transitions (admin)', () => {
  it('walks the home-delivery flow one step at a time and writes history', async () => {
    const admin = await adminAgent(h);
    const { order } = await placeHome();
    expect(order.status).toBe('PLACED');
    for (const next of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      const r = await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: next });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe(next);
    }
    const detail = await admin.get(`/v1/admin/orders/${order.id}`).expect(200);
    expect(detail.body.history.map((e: { status: string }) => e.status)).toEqual(['PLACED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    expect(detail.body.next).toEqual([]);
    expect(await h.prisma.orderStatusEvent.count({ where: { orderId: order.id } })).toBe(4);
  });

  it('rejects skipping steps and going backwards', async () => {
    const admin = await adminAgent(h);
    const { order } = await placeHome();
    const skip = await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'DELIVERED' });
    expect(skip.status).toBe(409);
    expect(skip.body.error.code).toBe('INVALID_TRANSITION');
    await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'PREPARING' }).expect(200);
    expect((await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'PLACED' })).status).toBe(409);
  });

  it('rejects a status that belongs to another method', async () => {
    const admin = await adminAgent(h);
    const { order } = await placeHome();
    expect((await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'READY_FOR_PICKUP' })).status).toBe(409);
    expect((await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'NOT_A_STATUS' })).status).toBe(400);
  });

  it('follows the pickup flow and never confirms a pickup before READY_FOR_PICKUP', async () => {
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(h.clock.now().getTime() + 2 * 3_600_000))).expect(201);
    expect(body.status).toBe('PICKUP_REQUESTED');
    for (const s of ['PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP']) await admin.patch(`/v1/admin/orders/${body.id}`).send({ status: s }).expect(200);
  });

  it('finished and cancelled orders are locked', async () => {
    const admin = await adminAgent(h);
    const a = await placeHome();
    await admin.patch(`/v1/admin/orders/${a.order.id}`).send({ status: 'CANCELLED' }).expect(200);
    expect((await admin.patch(`/v1/admin/orders/${a.order.id}`).send({ status: 'PREPARING' })).status).toBe(409);
    expect((await admin.patch(`/v1/admin/orders/${a.order.id}`).send({ status: 'CANCELLED' })).status).toBe(409);
    const b = await placeHome();
    for (const s of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) await admin.patch(`/v1/admin/orders/${b.order.id}`).send({ status: s }).expect(200);
    expect((await admin.patch(`/v1/admin/orders/${b.order.id}`).send({ status: 'CANCELLED' })).status).toBe(409);
  });

  it('two admins racing on the same step: exactly one wins', async () => {
    const a1 = await adminAgent(h);
    const a2 = await adminAgent(h);
    const { order } = await placeHome();
    const rs = await Promise.all([a1.patch(`/v1/admin/orders/${order.id}`).send({ status: 'PREPARING' }), a2.patch(`/v1/admin/orders/${order.id}`).send({ status: 'PREPARING' })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('stock follows the order', () => {
  it('cancelling releases the reservation', async () => {
    const admin = await adminAgent(h);
    const { variant, order } = await placeHome(3);
    expect(await inv(variant.id)).toMatchObject({ quantityOnHand: 10, reservedQuantity: 3 });
    await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'CANCELLED', reason: 'customer called' }).expect(200);
    expect(await inv(variant.id)).toMatchObject({ quantityOnHand: 10, reservedQuantity: 0 });
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.cancelReason).toBe('customer called');
  });
  it('finishing commits the sale: on-hand drops, reservation clears', async () => {
    const admin = await adminAgent(h);
    const { variant, order } = await placeHome(3);
    for (const s of ['PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED']) await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: s }).expect(200);
    expect(await inv(variant.id)).toMatchObject({ quantityOnHand: 7, reservedQuantity: 0 });
  });
  it('the stock ledger matches the counters and cannot be edited', async () => {
    const admin = await adminAgent(h);
    const { variant, order } = await placeHome(2);
    await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: 'CANCELLED' }).expect(200);
    const moves = await h.prisma.stockMovement.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(moves.map((m) => [m.type, m.qtyDeltaReserved])).toEqual([['RESERVE', 2], ['RELEASE', -2]]);
    expect(moves.reduce((s, m) => s + m.qtyDeltaReserved, 0)).toBe((await inv(variant.id)).reservedQuantity);
    await expect(h.prisma.stockMovement.update({ where: { id: moves[0]!.id }, data: { reason: 'tamper' } })).rejects.toThrow();
    await expect(h.prisma.stockMovement.deleteMany({ where: { orderId: order.id } })).rejects.toThrow();
  });
  it('a cancelled order frees stock for the next customer', async () => {
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { stock: 1, outletId: shop.outlet.id });
    const first = await postOrder(c, home([line(variant.id)])).expect(201);
    const c2 = await customer(h);
    expect((await postOrder(c2, home([line(variant.id)]))).status).toBe(409);
    await admin.patch(`/v1/admin/orders/${first.body.id}`).send({ status: 'CANCELLED' }).expect(200);
    expect((await postOrder(c2, home([line(variant.id)]))).status).toBe(201);
  });
});

describe('manager is read-only', () => {
  it('can list and open orders and the summary', async () => {
    const mgr = await managerAgent(h);
    const { order } = await placeHome();
    const list = await mgr.get('/v1/admin/orders').expect(200);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0].orderNumber).toBe(order.orderNumber);
    await mgr.get(`/v1/admin/orders/${order.id}`).expect(200);
    const sum = await mgr.get('/v1/admin/summary').expect(200);
    expect(sum.body.orders.total).toBe(1);
  });
  it('cannot change an order: 403 READ_ONLY and nothing changes', async () => {
    const mgr = await managerAgent(h);
    const { order } = await placeHome();
    const r = await mgr.patch(`/v1/admin/orders/${order.id}`).send({ status: 'PREPARING' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('READ_ONLY');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PLACED');
  });
});

describe('admin order list', () => {
  it('filters by status, method and search text', async () => {
    const admin = await adminAgent(h);
    const a = await placeHome();
    await placeHome();
    await admin.patch(`/v1/admin/orders/${a.order.id}`).send({ status: 'PREPARING' }).expect(200);
    expect((await admin.get('/v1/admin/orders?status=PREPARING').expect(200)).body.total).toBe(1);
    expect((await admin.get('/v1/admin/orders?method=EXPRESS_PICKUP').expect(200)).body.total).toBe(0);
    expect((await admin.get(`/v1/admin/orders?q=${a.order.orderNumber.slice(0, 8)}`).expect(200)).body.total).toBeGreaterThanOrEqual(1);
    expect((await admin.get('/v1/admin/orders?q=01811111111').expect(200)).body.total).toBe(2);
  });
  it('the summary counts what is there', async () => {
    const admin = await adminAgent(h);
    await placeHome(2);
    const s = (await admin.get('/v1/admin/summary').expect(200)).body;
    expect(s.orders).toMatchObject({ total: 1, today: 1, open: 1, itemsOrdered: 2, knownRevenuePoisha: 2 * 10_000 });
    expect(s.orders.byMethod.HOME_DELIVERY).toBe(1);
    expect(s.products.total).toBe(1);
  });
});
