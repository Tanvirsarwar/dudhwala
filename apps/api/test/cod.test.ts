import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminAgent, managerAgent, resetDb, startHarness, type Harness } from './support/harness.js';
import { bulk, customer, home, makeProduct, makeShop, pickup, postOrder, type CustomerAgent, type Shop } from './support/shop.js';

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
const FEES = { key: 'delivery.fees', value: { IN_CITY: 6000, OUTER_CITY: 12000 } };

describe('cash on delivery', () => {
  it('every order is COD and UNPAID until staff record the cash; nothing is marked paid by placing', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, home([line(variant.id)])).expect(201);
    expect(body).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID', paidAt: null });
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: body.id } });
    expect(row).toMatchObject({ paymentMethod: 'COD', paymentStatus: 'UNPAID', paidAt: null });
  });

  it('the client cannot choose a payment method or status', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, { ...home([line(variant.id)]), paymentStatus: 'PAID' })).status).toBe(400);
    expect((await postOrder(c, { ...home([line(variant.id)]), paymentMethod: 'ONLINE' })).status).toBe(400);
  });

  it('an admin records payment received; delivery status is unaffected; undo works; audited', async () => {
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, home([line(variant.id)])).expect(201);
    const paid = await admin.patch(`/v1/admin/orders/${body.id}/payment`).send({ paymentStatus: 'PAID' }).expect(200);
    expect(paid.body).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
    expect(paid.body.paidAt).not.toBeNull();
    expect((await c.get(`/v1/orders/${body.id}`).expect(200)).body.paymentStatus).toBe('PAID');
    const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'order.payment', entityId: body.id } });
    expect(log).toMatchObject({ before: { paymentStatus: 'UNPAID' }, after: { paymentStatus: 'PAID' } });
    await admin.patch(`/v1/admin/orders/${body.id}`).send({ status: 'PREPARING' }).expect(200);
    const undo = await admin.patch(`/v1/admin/orders/${body.id}/payment`).send({ paymentStatus: 'UNPAID' }).expect(200);
    expect(undo.body).toMatchObject({ status: 'PREPARING', paymentStatus: 'UNPAID', paidAt: null });
  });

  it('only an admin may change payment status; customers and managers cannot; cancelled orders cannot be marked paid', async () => {
    const admin = await adminAgent(h);
    const mgr = await managerAgent(h);
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, home([line(variant.id)])).expect(201);
    const url = `/v1/admin/orders/${body.id}/payment`;
    expect((await mgr.patch(url).send({ paymentStatus: 'PAID' })).body.error.code).toBe('READ_ONLY');
    expect((await c.patch(url).send({ paymentStatus: 'PAID' })).status).toBe(403);
    expect((await request(h.app.getHttpServer()).patch(url).send({ paymentStatus: 'PAID' })).status).toBeGreaterThanOrEqual(401);
    expect((await admin.patch(url).send({ paymentStatus: 'REFUNDED' })).status).toBe(400);
    await admin.patch(`/v1/admin/orders/${body.id}`).send({ status: 'CANCELLED' }).expect(200);
    expect((await admin.patch(url).send({ paymentStatus: 'PAID' })).status).toBe(409);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: body.id } })).paymentStatus).toBe('UNPAID');
  });

  it('there is no online-payment surface: no payment/webhook routes, no gateway settings', async () => {
    const api = request(h.app.getHttpServer());
    for (const [m, u] of [['post', '/v1/webhooks/payments'], ['post', '/v1/orders/x/payment'], ['post', '/v1/payments/sandbox/x/complete']] as const) {
      expect([404, 403]).toContain((await api[m](u).send({})).status);
    }
    const tables = (await h.prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`).map((t) => t.tablename);
    expect(tables).not.toContain('payment');
    expect(tables).not.toContain('payment_event');
    expect(await h.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE e.enumlabel IN ('PREPAID','PENDING_PAYMENT')`).toEqual([{ n: 0 }]);
  });
});

describe('delivery fee by zone (In Sylhet / Outer Sylhet)', () => {
  beforeEach(async () => {
    await h.prisma.setting.create({ data: FEES });
  });
  it('In Sylhet and Outer Sylhet each get their own fee, stored on the order and shown in the totals', async () => {
    const { variant } = await makeProduct(h, { category: 'bakery', priceTaka: 100, stock: 10, outletId: shop.outlet.id });
    const a = (await postOrder(c, home([line(variant.id, 2)], 'IN_CITY')).expect(201)).body;
    expect(a).toMatchObject({ zone: 'IN_CITY', subtotalPoisha: 20_000, deliveryFeePoisha: 6000, totalPoisha: 26_000 });
    const b = (await postOrder(c, home([line(variant.id, 2)], 'OUTER_CITY')).expect(201)).body;
    expect(b).toMatchObject({ zone: 'OUTER_CITY', subtotalPoisha: 20_000, deliveryFeePoisha: 12_000, totalPoisha: 32_000 });
    expect(await h.prisma.order.findMany({ select: { zone: true, deliveryFeePoisha: true, totalPoisha: true }, orderBy: { totalPoisha: 'asc' } })).toEqual([
      { zone: 'IN_CITY', deliveryFeePoisha: 6000, totalPoisha: 26_000 },
      { zone: 'OUTER_CITY', deliveryFeePoisha: 12_000, totalPoisha: 32_000 },
    ]);
    const admin = await adminAgent(h);
    const detail = (await admin.get(`/v1/admin/orders/${b.id}`).expect(200)).body;
    expect(detail).toMatchObject({ zone: 'OUTER_CITY', deliveryFeePoisha: 12_000 });
  });
  it('pickup and showroom orders are never charged delivery', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    const p = (await postOrder(c, pickup([line(variant.id)], shop.outlet.id, new Date(h.clock.now().getTime() + 2 * 3_600_000))).expect(201)).body;
    expect(p).toMatchObject({ deliveryFeePoisha: 0, totalPoisha: 1000 });
    const s = (await postOrder(c, bulk([line(variant.id, 20)])).expect(201)).body;
    expect(s).toMatchObject({ deliveryFeePoisha: 0, totalPoisha: 20_000 });
  });
  it('the client cannot send or override a fee', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    expect((await postOrder(c, { ...home([line(variant.id)]), deliveryFeePoisha: 0 })).status).toBe(400);
  });
  it('an admin sets the fees in whole taka; the public config serves them; managers cannot', async () => {
    const admin = await adminAgent(h);
    const body = { hours: { open: '10:00', close: '22:00' }, bulk: { minTotalQuantity: 20, minTotalTaka: 20000 }, deliveryFeesTaka: { IN_CITY: 50, OUTER_CITY: 120 } };
    const res = await admin.put('/v1/admin/config').send(body).expect(200);
    expect(res.body.deliveryFees).toEqual({ IN_CITY: 5000, OUTER_CITY: 12_000 });
    expect((await request(h.app.getHttpServer()).get('/v1/config').expect(200)).body.deliveryFees).toEqual({ IN_CITY: 5000, OUTER_CITY: 12_000 });
    expect((await admin.put('/v1/admin/config').send({ ...body, deliveryFeesTaka: { IN_CITY: -1, OUTER_CITY: 1 } })).status).toBe(400);
    expect((await (await managerAgent(h)).put('/v1/admin/config').send(body)).body.error.code).toBe('READ_ONLY');
  });
});

describe('showroom order', () => {
  it('is collected at the configured showroom outlet and follows the collection flow; stock commits on COLLECTED', async () => {
    const admin = await adminAgent(h);
    const { variant } = await makeProduct(h, { priceTaka: 10, stock: 100, outletId: shop.outlet.id });
    const { body } = await postOrder(c, bulk([line(variant.id, 20)])).expect(201);
    expect(body.outlet.id).toBe(shop.outlet.id);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: body.id } })).outletId).toBe(shop.collection.id);
    for (const s of ['PREPARING', 'READY_FOR_COLLECTION', 'COLLECTED']) await admin.patch(`/v1/admin/orders/${body.id}`).send({ status: s }).expect(200);
    const inv = await h.prisma.inventory.findFirstOrThrow({ where: { productVariantId: variant.id } });
    expect(inv).toMatchObject({ quantityOnHand: 80, reservedQuantity: 0 });
  });
});

describe('database lockdown (Supabase Data API)', () => {
  it('row level security is on for every table and no policies exist', async () => {
    const rows = await h.prisma.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    expect(rows.length).toBeGreaterThan(15);
    expect(rows.filter((r) => !r.rowsecurity)).toEqual([]);
    expect(await h.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`).toEqual([{ n: 0 }]);
  });
  it('a Data-API style role (anon/authenticated) can read nothing, even though it could connect', async () => {
    await h.prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dw_test_anon') THEN CREATE ROLE dw_test_anon NOLOGIN; END IF; END $$`); // eslint-disable-line no-restricted-properties -- fixed text
    await h.prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO dw_test_anon; GRANT SELECT ON ALL TABLES IN SCHEMA public TO dw_test_anon'); // eslint-disable-line no-restricted-properties -- fixed text
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    await postOrder(c, home([line(variant.id)])).expect(201);
    const seen = await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE dw_test_anon'); // eslint-disable-line no-restricted-properties -- fixed text
      return tx.$queryRaw<{ n: number }[]>`SELECT (SELECT count(*) FROM "order") + (SELECT count(*) FROM "user") + (SELECT count(*) FROM product)  AS n`;
    });
    expect(Number(seen[0]?.n)).toBe(0);
  });
});
