import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { SlotGenerator, withinHours } from '../src/delivery/delivery-config.service.js';
import { timeOfDay } from '../src/delivery/slots.js';
import { browser, loginStaff, makeStaff, PASSWORD, resetDb, startHarness, type Harness } from './support/harness.js';
import { checkoutFlow, customer, makeOutletReady, makeProduct, staffAt, superAdmin } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

const onHand = async (outletId: string, variantId: string) =>
  (await h.prisma.inventory.findUnique({ where: { outletId_productVariantId: { outletId, productVariantId: variantId } } }))?.quantityOnHand ?? null;

describe('operating hours and closures', () => {
  it('limits generated slots to opening hours and validates input', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { outlet } = await makeOutletReady(h, [variants[0]!.id]);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    await mgr.put(`/v1/admin/outlets/${outlet.id}/hours`).send({ hours: [{ weekday: 0, opensAt: '10:00', closesAt: '09:00' }] }).expect(400);
    await mgr
      .put(`/v1/admin/outlets/${outlet.id}/hours`)
      .send({ hours: [{ weekday: 0, opensAt: '08:00', closesAt: '12:00' }, { weekday: 0, opensAt: '11:00', closesAt: '13:00' }] })
      .expect(400);
    // Open 13:00–17:00 every day: the 14–16 window fits, 18–20 does not.
    const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: '13:00', closesAt: '17:00' }));
    const r = await mgr.put(`/v1/admin/outlets/${outlet.id}/hours`).send({ hours }).expect(200);
    expect(r.body.hours).toHaveLength(7);
    await h.prisma.deliverySlot.deleteMany({ where: { outletId: outlet.id } });
    await h.app.get(SlotGenerator).generate(outlet.id);
    const slots = await h.prisma.deliverySlot.findMany({ where: { outletId: outlet.id } });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.startsAt.toISOString().slice(11, 16) === '08:00')).toBe(true); // 14:00 Dhaka
    expect(withinHours([{ weekday: 1, opensAt: timeOfDay('09:00'), closesAt: timeOfDay('21:00') }], 1, timeOfDay('18:00'), timeOfDay('20:00'))).toBe(true);
    expect(await h.prisma.auditLog.count({ where: { action: 'outlet.hours_update' } })).toBe(1);
  });

  it('a closure closes empty slots and reports slots that already hold orders', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { outlet, areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const { slot } = await checkoutFlow(c, areaId, 'COD');
    const date = new Date(new Date(slot.startsAt).getTime() + 6 * 3_600_000).toISOString().slice(0, 10);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const r = await mgr.post(`/v1/admin/outlets/${outlet.id}/closures`).send({ date, reason: 'ঈদের ছুটি' }).expect(201);
    expect(r.body.closedEmptySlots).toBeGreaterThanOrEqual(1);
    expect(r.body.slotsWithOrders).toHaveLength(1);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200); // cart was emptied by the order
    const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    expect(q.body.slots.some((s: { startsAt: string }) => new Date(new Date(s.startsAt).getTime() + 6 * 3_600_000).toISOString().slice(0, 10) === date)).toBe(false);
    const other = await makeOutletReady(h, [], { areaId, zoneId: undefined });
    await mgr.post(`/v1/admin/outlets/${other.outlet.id}/closures`).send({ date, reason: 'x x' }).expect(404);
    await mgr.delete(`/v1/admin/outlets/${outlet.id}/closures/${date}`).expect(204);
    await mgr.delete(`/v1/admin/outlets/${outlet.id}/closures/${date}`).expect(404);
  });

  it('outlet staff can read hours but not change them', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const staff = await staffAt(h, 'OUTLET_STAFF', outlet.id);
    await staff.get(`/v1/admin/outlets/${outlet.id}/hours`).expect(200);
    await staff.put(`/v1/admin/outlets/${outlet.id}/hours`).send({ hours: [] }).expect(403);
  });
});

describe('stock counts (reconciliation)', () => {
  it('posts RECONCILE movements for differences, preserving sales made during the count', async () => {
    const { variants } = await makeProduct(h, [100, 200]);
    const [a, b] = [variants[0]!.id, variants[1]!.id];
    const { outlet } = await makeOutletReady(h, [a, b], { stock: 10 });
    const staff = await staffAt(h, 'OUTLET_STAFF', outlet.id, ['inventory.count']);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const start = await staff.post(`/v1/admin/outlets/${outlet.id}/stock-counts`).expect(201);
    await staff.post(`/v1/admin/outlets/${outlet.id}/stock-counts`).expect(409); // one open count at a time
    // A sale-like change happens during the count.
    await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/adjust`).send({ variantId: a, deltaQty: -2, reason: 'walk-in sale' }).expect(201);
    await staff.put(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}/lines`).send({ lines: [{ variantId: a, countedQty: 7 }] }).expect(200);
    await staff.put(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}/lines`).send({ lines: [{ variantId: newId(), countedQty: 1 }] }).expect(400);
    await staff.post(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}/complete`).expect(403);
    const done = await mgr.post(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}/complete`).expect(200);
    expect(done.body).toMatchObject({ status: 'COMPLETED', adjustments: [{ variantId: a, delta: -3 }], uncounted: 1 });
    expect(await onHand(outlet.id, a)).toBe(5); // 10 − 2 (sale) − 3 (shrinkage found by count)
    expect(await onHand(outlet.id, b)).toBe(10); // not counted: unchanged
    const mv = await h.prisma.stockMovement.findFirstOrThrow({ where: { outletId: outlet.id, type: 'RECONCILE' } });
    expect(mv).toMatchObject({ qtyDeltaOnHand: -3, reason: `Stock count ${start.body.id}` });
    await mgr.post(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}/complete`).expect(409);
    const view = await mgr.get(`/v1/admin/outlets/${outlet.id}/stock-counts/${start.body.id}`).expect(200);
    expect(view.body.lines.find((l: { variantId: string }) => l.variantId === a)).toMatchObject({ systemQty: 10, countedQty: 7, difference: -3 });
  });

  it('is outlet-scoped', async () => {
    const { outlet } = await makeOutletReady(h, (await makeProduct(h, [10])).variants.map((v) => v.id));
    const other = await makeOutletReady(h, []);
    const mgrB = await staffAt(h, 'OUTLET_MANAGER', other.outlet.id);
    await mgrB.post(`/v1/admin/outlets/${outlet.id}/stock-counts`).expect(404);
    const sa = await superAdmin(h);
    const s = await sa.post(`/v1/admin/outlets/${outlet.id}/stock-counts`).expect(201);
    await mgrB.get(`/v1/admin/outlets/${outlet.id}/stock-counts/${s.body.id}`).expect(404);
    await sa.post(`/v1/admin/outlets/${outlet.id}/stock-counts/${s.body.id}/cancel`).expect(200);
  });
});

describe('stock transfers', () => {
  async function twoOutlets() {
    const { variants } = await makeProduct(h, [100]);
    const v = variants[0]!.id;
    const A = (await makeOutletReady(h, [v], { stock: 10 })).outlet;
    const B = (await makeOutletReady(h, [], {})).outlet;
    return { v, A, B, mgrA: await staffAt(h, 'OUTLET_MANAGER', A.id), mgrB: await staffAt(h, 'OUTLET_MANAGER', B.id), sa: await superAdmin(h) };
  }

  it('is off by default', async () => {
    const { v, A, B, mgrB } = await twoOutlets();
    const r = await mgrB.post('/v1/admin/transfers').send({ fromOutletId: A.id, toOutletId: B.id, lines: [{ variantId: v, qty: 3 }] }).expect(403);
    expect(r.body.error.message).toMatch(/turned off/);
  });

  it('request → approve → dispatch → receive moves stock, recording shortfalls', async () => {
    const { v, A, B, mgrA, mgrB, sa } = await twoOutlets();
    await sa.put('/v1/admin/settings/inventory.transfers.enabled').send({ value: true }).expect(204);
    const t = await mgrB.post('/v1/admin/transfers').send({ fromOutletId: A.id, toOutletId: B.id, lines: [{ variantId: v, qty: 4 }] }).expect(201);
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/dispatch`).expect(409); // not approved
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/approve`).expect(403); // managers cannot approve
    await sa.post(`/v1/admin/transfers/${t.body.id}/approve`).expect(200);
    await mgrB.post(`/v1/admin/transfers/${t.body.id}/dispatch`).expect(403); // only the source dispatches
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/dispatch`).expect(200);
    expect(await onHand(A.id, v)).toBe(6);
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/receive`).send({ lines: [{ variantId: v, receivedQty: 3 }] }).expect(403);
    await mgrB.post(`/v1/admin/transfers/${t.body.id}/receive`).send({ lines: [{ variantId: v, receivedQty: 5 }] }).expect(400);
    const rec = await mgrB.post(`/v1/admin/transfers/${t.body.id}/receive`).send({ lines: [{ variantId: v, receivedQty: 3 }], note: 'one broken' }).expect(200);
    expect(rec.body.shortfalls).toEqual([{ variantId: v, sent: 4, received: 3 }]);
    expect(await onHand(B.id, v)).toBe(3);
    const types = (await h.prisma.stockMovement.findMany({ where: { transferId: t.body.id } })).map((m) => m.type).sort();
    expect(types).toEqual(['TRANSFER_IN', 'TRANSFER_OUT']);
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/cancel`).expect(403);
  });

  it('cannot dispatch more than the source holds, and third outlets see nothing', async () => {
    const { v, A, B, mgrA, mgrB, sa } = await twoOutlets();
    await sa.put('/v1/admin/settings/inventory.transfers.enabled').send({ value: true }).expect(204);
    const C = (await makeOutletReady(h, [])).outlet;
    const mgrC = await staffAt(h, 'OUTLET_MANAGER', C.id);
    const t = await mgrB.post('/v1/admin/transfers').send({ fromOutletId: A.id, toOutletId: B.id, lines: [{ variantId: v, qty: 50 }] }).expect(201);
    await mgrC.post('/v1/admin/transfers').send({ fromOutletId: A.id, toOutletId: B.id, lines: [{ variantId: v, qty: 1 }] }).expect(404);
    await mgrC.post(`/v1/admin/transfers/${t.body.id}/approve`).expect(403);
    expect((await mgrC.get('/v1/admin/transfers').expect(200)).body).toEqual([]);
    await sa.post(`/v1/admin/transfers/${t.body.id}/approve`).expect(200);
    await mgrA.post(`/v1/admin/transfers/${t.body.id}/dispatch`).expect(409);
    expect(await onHand(A.id, v)).toBe(10);
    expect((await h.prisma.stockTransfer.findUniqueOrThrow({ where: { id: t.body.id } })).status).toBe('APPROVED');
    await mgrB.post(`/v1/admin/transfers/${t.body.id}/cancel`).expect(200);
  });
});

describe('customer privacy', () => {
  it('exports only the customer’s own data', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    const other = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    await checkoutFlow(c, areaId, 'COD');
    const r = await c.get('/v1/me/privacy/export').expect(200);
    expect(r.headers['content-disposition']).toMatch(/attachment/);
    expect(r.body.account.phone).toBe(`+88${c.phone}`);
    expect(r.body.orders).toHaveLength(1);
    expect((await other.get('/v1/me/privacy/export').expect(200)).body.orders).toHaveLength(0);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|tokenHash/);
  });

  it('deletion waits for open orders, then anonymises the account and order contact details', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const { placed } = await checkoutFlow(c, areaId, 'COD');
    const req = await c.post('/v1/me/privacy/delete-request').send({ note: 'please delete' }).expect(201);
    await c.post('/v1/me/privacy/delete-request').send({}).expect(409);
    const sa = await superAdmin(h);
    const list = await sa.get('/v1/admin/privacy-requests').expect(200);
    expect(list.body[0]).toMatchObject({ id: req.body.id, openOrders: 1 });
    await sa.post(`/v1/admin/privacy-requests/${req.body.id}/process`).send({ decision: 'COMPLETE' }).expect(409);
    await c.post(`/v1/me/orders/${placed.orderId}/cancel`).send({ reason: 'privacy' }).expect(200);
    await sa.post(`/v1/admin/privacy-requests/${req.body.id}/process`).send({ decision: 'COMPLETE' }).expect(200);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(u).toMatchObject({ phone: null, fullName: null, status: 'DELETED' });
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(o.shipPhone).toBe('00000000000');
    expect(o.totalPoisha).toBeGreaterThan(0); // financial record kept
    expect(await h.prisma.address.count({ where: { userId: c.userId } })).toBe(0);
    await c.get('/v1/me/privacy').expect(401); // sessions revoked
  });

  it('only Super Admin processes requests', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    await mgr.get('/v1/admin/privacy-requests').expect(403);
  });
});

describe('maintenance mode', () => {
  it('pauses checkout and payment while browsing continues', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const sa = await superAdmin(h);
    await sa.put('/v1/admin/settings/storefront.maintenance').send({ value: true }).expect(204);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const r = await c.post('/v1/checkout/quote').send({ areaId }).expect(503);
    expect(r.body.error.code).toBe('SERVICE_UNAVAILABLE');
    const home = await c.get('/v1/content/home').expect(200);
    expect(home.body.maintenance).toBe(true);
    await c.get('/v1/catalog/products').expect(200);
    await sa.put('/v1/admin/settings/storefront.maintenance').send({ value: false }).expect(204);
    await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
  });
});

describe('timestamps', () => {
  it('stores app-written instants exactly, even when the server default TimeZone is Asia/Dhaka', async () => {
    const tz = await h.prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
    expect(tz[0]?.tz).toBe('UTC'); // session pinned by PrismaService
    const at = new Date('2026-03-01T00:00:00.000Z');
    const id = newId();
    await h.prisma.job.create({ data: { id, type: 'tz-check', payload: {}, runAt: at } });
    const raw = await h.prisma.$queryRaw<{ utc: string }[]>`SELECT to_char(run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS utc FROM job WHERE id = ${id}::uuid`;
    expect(raw[0]?.utc).toBe('2026-03-01T00:00:00');
  });
});

describe('staff credentials', () => {
  it('a manager resets a rider’s password; the old one and old sessions stop working', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id, ['staff.manage_outlet']);
    const riderUser = await makeStaff(h.prisma, 'DELIVERY_STAFF', outlet.id);
    const riderSession = await loginStaff(h, riderUser);
    const a = await h.prisma.outletStaff.findUniqueOrThrow({ where: { userId: riderUser.user.id } });
    await mgr.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/reset-credentials`).send({}).expect(400);
    await mgr.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/reset-credentials`).send({ temporaryPassword: 'brand-new-password-1' }).expect(200);
    await riderSession.get('/v1/rider/deliveries').expect(401);
    const fresh = await browser(h.app);
    await fresh.post('/v1/auth/staff/login').send({ login: riderUser.email, password: PASSWORD }).expect(401);
    await fresh.post('/v1/auth/staff/login').send({ login: riderUser.email, password: 'brand-new-password-1' }).expect(200);
    expect(await h.prisma.auditLog.count({ where: { action: 'staff.reset_credentials' } })).toBe(1);
  });

  it('only a Super Admin resets a manager’s two-factor; the manager then enrols again', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const mgrA = await staffAt(h, 'OUTLET_MANAGER', outlet.id, ['staff.manage_outlet']);
    const other = await makeStaff(h.prisma, 'OUTLET_MANAGER', outlet.id);
    const a = await h.prisma.outletStaff.findUniqueOrThrow({ where: { userId: other.user.id } });
    await mgrA.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/reset-credentials`).send({ resetMfa: true }).expect(403);
    const sa = await superAdmin(h);
    await sa.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/reset-credentials`).send({ resetMfa: true }).expect(200);
    const login = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: other.email, password: PASSWORD }).expect(200);
    expect(login.body).toEqual({ mfaRequired: true, mfaEnrolled: false });
  });

  it('staff change their own password with the current one; other sessions end', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const s = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const one = await loginStaff(h, s);
    const two = await loginStaff(h, s);
    await one.post('/v1/auth/staff/password').send({ currentPassword: 'wrong-password', newPassword: 'another-good-password' }).expect(400);
    await one.post('/v1/auth/staff/password').send({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400);
    await one.post('/v1/auth/staff/password').send({ currentPassword: PASSWORD, newPassword: 'another-good-password' }).expect(204);
    await one.get(`/v1/admin/outlets/${outlet.id}`).expect(200);
    await two.get(`/v1/admin/outlets/${outlet.id}`).expect(401);
  });

  it('a deactivated person can be reactivated', async () => {
    const { outlet } = await makeOutletReady(h, []);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id, ['staff.manage_outlet']);
    const s = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const a = await h.prisma.outletStaff.findUniqueOrThrow({ where: { userId: s.user.id } });
    await mgr.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/deactivate`).expect(200);
    await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: s.email, password: PASSWORD }).expect(401);
    await mgr.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/activate`).expect(200);
    await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: s.email, password: PASSWORD }).expect(200);
  });
});

describe('rate limits on shopping actions', () => {
  it('slows down coupon guessing per IP', async () => {
    const c = await customer(h);
    for (let i = 0; i < 10; i++) await c.put('/v1/cart/coupon').send({ code: `GUESS${i}` });
    const r = await c.put('/v1/cart/coupon').send({ code: 'GUESS10' }).expect(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits payment attempts per order', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id]);
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const { placed } = await checkoutFlow(c, areaId, 'ONLINE');
    for (let i = 0; i < 10; i++) await c.post(`/v1/payments/${placed.orderId}/initiate`);
    await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(429);
  });
});
