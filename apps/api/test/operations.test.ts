import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { newId } from '../src/common/crypto.js';
import { resetDb, startHarness, type Harness } from './support/harness.js';
import { checkoutFlow, customer, makeOutletReady, makeProduct, staffAt, superAdmin } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

const runJobs = async () => {
  const jobs = h.app.get(JobsService);
  while ((await jobs.runOnce()) > 0);
};

async function codOrder(qty = 2, stock = 10) {
  const { variants } = await makeProduct(h, [150]);
  const ready = await makeOutletReady(h, [variants[0]!.id], { stock });
  const c = await customer(h);
  await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: qty }).expect(200);
  const flow = await checkoutFlow(c, ready.areaId, 'COD');
  return { c, ...ready, orderId: flow.placed.orderId as string, variantId: variants[0]!.id };
}

const inventoryOf = (outletId: string) => h.prisma.inventory.findFirstOrThrow({ where: { outletId } });

describe('outlet order operations', () => {
  it('runs the full COD lifecycle: confirm → prepare → ready → assign → dispatch → rider delivers → manager takes cash', async () => {
    const { orderId, outlet } = await codOrder(2);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const rider = await staffAt(h, 'DELIVERY_STAFF', outlet.id);

    const board = await mgr.get(`/v1/admin/outlets/${outlet.id}/orders?status=PLACED`).expect(200);
    expect(board.body.data.map((o: { id: string }) => o.id)).toEqual([orderId]);
    const detail = await mgr.get(`/v1/admin/orders/${orderId}`).expect(200);
    expect(detail.body.allowedTransitions).toEqual(expect.arrayContaining(['CONFIRMED', 'REJECTED', 'CANCELLED']));

    for (const to of ['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH']) await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to }).expect(200);
    const pick = await mgr.get(`/v1/admin/outlets/${outlet.id}/picklist?date=2026-11-01`).expect(200);
    expect(pick.body.lines).toEqual([]); // READY orders are already packed
    const dispatchEarly = await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(409);
    expect(dispatchEarly.body.error.message).toMatch(/rider/i);

    const riders = await mgr.get(`/v1/admin/outlets/${outlet.id}/riders`).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/assign-rider`).send({ riderUserId: riders.body[0].id }).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(200);
    let inv = await inventoryOf(outlet.id);
    expect([inv.quantityOnHand, inv.reservedQuantity]).toEqual([8, 0]); // committed at dispatch

    const mine = await rider.get('/v1/rider/deliveries').expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ collectPoisha: 36000, order: { shipName: 'রহিম' } });
    const d = mine.body[0].deliveryId as string;
    await rider.post(`/v1/rider/deliveries/${d}/status`).send({ to: 'ARRIVED', clientUpdateId: 'arrive-0001' }).expect(200);
    await rider.post(`/v1/rider/deliveries/${d}/complete`).send({ clientUpdateId: 'done-0001' }).expect(400); // must enter cash
    await rider.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 36000, clientUpdateId: 'done-0001' }).expect(200);
    const replay = await rider.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 36000, clientUpdateId: 'done-0001' }).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('DELIVERED');

    // Rider cannot confirm their own cash handover; the manager does.
    const cod = await mgr.get(`/v1/admin/outlets/${outlet.id}/cod?status=COLLECTED`).expect(200);
    await rider.post(`/v1/admin/cod/${cod.body[0].id}/confirm-handover`).expect(403);
    await mgr.post(`/v1/admin/cod/${cod.body[0].id}/confirm-handover`).expect(200);
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, events: true } });
    expect(o.paymentStatus).toBe('PAID');
    expect(o.payments[0]).toMatchObject({ method: 'COD', status: 'PAID', paidAmountPoisha: 36000 });
    expect(o.events.map((e) => e.toStatus)).toEqual(['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED']);
    inv = await inventoryOf(outlet.id);
    expect([inv.quantityOnHand, inv.reservedQuantity]).toEqual([8, 0]);
  });

  it('records COD discrepancies and lets only the Super Admin resolve them', async () => {
    const { orderId, outlet } = await codOrder(1);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const rider = await staffAt(h, 'DELIVERY_STAFF', outlet.id);
    for (const to of ['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH']) await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to }).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/assign-rider`).send({ riderUserId: rider.userId }).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(200);
    const d = (await rider.get('/v1/rider/deliveries').expect(200)).body[0].deliveryId;
    await rider.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 20000, clientUpdateId: 'short-0001' }).expect(400);
    await rider.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 20000, note: 'Customer paid less', clientUpdateId: 'short-0002' }).expect(200);
    const cod = await h.prisma.codCollection.findFirstOrThrow();
    expect(cod.status).toBe('DISCREPANCY');
    await mgr.post(`/v1/admin/cod/${cod.id}/confirm-handover`).expect(409);
    await mgr.post(`/v1/admin/cod/${cod.id}/resolve`).send({ receivedPoisha: 20000, note: 'agreed' }).expect(403);
    const sa = await superAdmin(h);
    await sa.post(`/v1/admin/cod/${cod.id}/resolve`).send({ receivedPoisha: 20000, note: 'Customer short-paid, approved' }).expect(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PAID');
  });

  it('handles failed delivery: goods return and stay held, then reschedule or close with restock/write-off', async () => {
    const { orderId, outlet } = await codOrder(2);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const rider = await staffAt(h, 'DELIVERY_STAFF', outlet.id);
    const dispatch = async () => {
      await mgr.post(`/v1/admin/orders/${orderId}/assign-rider`).send({ riderUserId: rider.userId }).expect(200);
      await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(200);
    };
    for (const to of ['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH']) await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to }).expect(200);
    await dispatch();
    let d = (await rider.get('/v1/rider/deliveries').expect(200)).body[0].deliveryId;
    await rider.post(`/v1/rider/deliveries/${d}/fail`).send({ reason: 'CUSTOMER_UNAVAILABLE', note: 'Phone off', clientUpdateId: 'fail-0001' }).expect(200);
    let inv = await inventoryOf(outlet.id);
    expect([inv.quantityOnHand, inv.reservedQuantity]).toEqual([10, 2]); // back on the shelf, held for this order

    // Reschedule into a later slot (capacity enforced).
    const slots = await mgr.get(`/v1/admin/outlets/${outlet.id}/slots`).expect(200);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const later = slots.body.find((s: { id: string; startsAt: string }) => s.id !== order.deliverySlotId && new Date(s.startsAt) > order.slotStartsAt);
    await mgr.post(`/v1/admin/orders/${orderId}/reschedule`).send({ slotId: later.id }).expect(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY_FOR_DISPATCH');
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(200);
    d = (await rider.get('/v1/rider/deliveries').expect(200)).body[0].deliveryId;
    await rider.post(`/v1/rider/deliveries/${d}/fail`).send({ reason: 'REFUSED', note: 'Refused at door', clientUpdateId: 'fail-0002' }).expect(200);

    // Close: returned goods must be classified.
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CANCELLED', reason: 'refused twice' }).expect(400);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CANCELLED', reason: 'refused twice', returnedGoods: 'WRITE_OFF' }).expect(200);
    inv = await inventoryOf(outlet.id);
    expect([inv.quantityOnHand, inv.reservedQuantity]).toEqual([8, 0]);
    expect(await h.prisma.deliveryAttempt.count()).toBe(2);
    expect((await h.prisma.codCollection.findFirstOrThrow()).status).toBe('NOT_COLLECTED');
  });

  it('rejection requires a reason and releases everything', async () => {
    const { orderId, outlet } = await codOrder(3);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'REJECTED' }).expect(400);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'REJECTED', reason: 'Milk delivery truck late' }).expect(200);
    expect((await inventoryOf(outlet.id)).reservedQuantity).toBe(0);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CONFIRMED' }).expect(409);
  });

  it('enforces per-role permissions on transitions', async () => {
    const { orderId, outlet } = await codOrder(1);
    const staff = await staffAt(h, 'OUTLET_STAFF', outlet.id);
    const staffConfirm = await staffAt(h, 'OUTLET_STAFF', outlet.id, ['orders.confirm']);
    await staff.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CONFIRMED' }).expect(403);
    await staffConfirm.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CONFIRMED' }).expect(200);
    await staff.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'PREPARING' }).expect(200);
    await staff.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'CANCELLED', reason: 'x x x' }).expect(403);
  });

  it('auto-confirms when the outlet is set to', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { autoConfirm: true });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const { placed } = await checkoutFlow(c, areaId, 'COD');
    expect(placed.status).toBe('CONFIRMED');
  });
});

describe('outlet and rider isolation for operational routes', () => {
  it('outlet A staff cannot see or act on outlet B orders, riders, COD, slots or reports', async () => {
    const a = await codOrder(1);
    const b = await codOrder(1);
    const mgrA = await staffAt(h, 'OUTLET_MANAGER', a.outlet.id);
    const riderB = await staffAt(h, 'DELIVERY_STAFF', b.outlet.id);
    await mgrA.get(`/v1/admin/orders/${b.orderId}`).expect(404);
    await mgrA.post(`/v1/admin/orders/${b.orderId}/transition`).send({ to: 'CONFIRMED' }).expect(404);
    await mgrA.post(`/v1/admin/orders/${b.orderId}/assign-rider`).send({ riderUserId: riderB.userId }).expect(404);
    await mgrA.get(`/v1/admin/outlets/${b.outlet.id}/orders`).expect(404);
    await mgrA.get(`/v1/admin/outlets/${b.outlet.id}/riders`).expect(404);
    await mgrA.get(`/v1/admin/outlets/${b.outlet.id}/cod`).expect(404);
    await mgrA.get(`/v1/admin/outlets/${b.outlet.id}/slots`).expect(404);
    await mgrA.get(`/v1/admin/outlets/${b.outlet.id}/picklist`).expect(404);
    await mgrA.get(`/v1/admin/reports/sales?outletId=${b.outlet.id}`).expect(404);
    const all = await mgrA.get('/v1/admin/orders').expect(200);
    expect(all.body.data.map((o: { id: string }) => o.id)).toEqual([a.orderId]);
    // A rider from another outlet cannot be assigned to an A order.
    await mgrA.post(`/v1/admin/orders/${a.orderId}/transition`).send({ to: 'CONFIRMED' }).expect(200);
    await mgrA.post(`/v1/admin/orders/${a.orderId}/assign-rider`).send({ riderUserId: riderB.userId }).expect(404);
  });

  it('riders see only their own active deliveries; contact details vanish after the grace period', async () => {
    const { orderId, outlet } = await codOrder(1);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const r1 = await staffAt(h, 'DELIVERY_STAFF', outlet.id);
    const r2 = await staffAt(h, 'DELIVERY_STAFF', outlet.id);
    for (const to of ['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH']) await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to }).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/assign-rider`).send({ riderUserId: r1.userId }).expect(200);
    await mgr.post(`/v1/admin/orders/${orderId}/transition`).send({ to: 'OUT_FOR_DELIVERY' }).expect(200);
    const d = (await r1.get('/v1/rider/deliveries').expect(200)).body[0].deliveryId;
    expect((await r2.get('/v1/rider/deliveries').expect(200)).body).toEqual([]);
    await r2.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 1, clientUpdateId: 'steal-0001' }).expect(404);
    await r1.get(`/v1/admin/orders/${orderId}`).expect(403); // riders never use the order board
    await r1.get('/v1/admin/dashboard').expect(403);
    await mgr.get('/v1/rider/deliveries').expect(403);
    await r1.post(`/v1/rider/deliveries/${d}/complete`).send({ codCollectedPoisha: 21000, clientUpdateId: 'ok-00001' }).expect(200);
    expect((await r1.get('/v1/rider/deliveries').expect(200)).body).toHaveLength(1);
    h.clock.advance(3_600_000); // keep the rider session alive (2 h idle timeout)
    expect((await r1.get('/v1/rider/deliveries').expect(200)).body).toHaveLength(1);
    h.clock.advance(3_600_000 + 1);
    expect((await r1.get('/v1/rider/deliveries').expect(200)).body).toEqual([]);
  });
});

describe('delivery configuration', () => {
  it('Super Admin sets up areas, zones and rules; managers manage only their own slots', async () => {
    const sa = await superAdmin(h);
    const area = await sa.post('/v1/admin/areas').send({ slug: 'zindabazar', nameBn: 'জিন্দাবাজার' }).expect(201);
    const zone = await sa.post('/v1/admin/zones').send({ name: 'Central', areaIds: [area.body.id] }).expect(201);
    const outlet = await sa.post('/v1/admin/outlets').send({ code: 'JLB', nameBn: 'জালালাবাদ', addressLine: 'TEST' }).expect(201);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.body.id);
    await mgr.put(`/v1/admin/outlets/${outlet.body.id}/zone-rules/${zone.body.id}`).send({ active: true, deliveryFeePoisha: 5000 }).expect(403);
    await sa.put(`/v1/admin/outlets/${outlet.body.id}/zone-rules/${zone.body.id}`).send({ active: true, deliveryFeePoisha: 5000, codEnabled: true }).expect(200);
    await mgr.post('/v1/admin/areas').send({ slug: 'x', nameBn: 'x' }).expect(403);
    await mgr.post(`/v1/admin/outlets/${outlet.body.id}/slot-templates`).send({ weekday: 0, startsAt: '16:00', endsAt: '15:00', capacity: 5, cutoffMinutes: 60 }).expect(400);
    await mgr.post(`/v1/admin/outlets/${outlet.body.id}/slot-templates`).send({ weekday: 0, startsAt: '15:00', endsAt: '17:00', capacity: 5, cutoffMinutes: 60 }).expect(201);
    const gen = await mgr.post(`/v1/admin/outlets/${outlet.body.id}/slots/generate`).expect(200);
    expect(gen.body.created).toBe(1); // only Sunday 2026-11-01 within the 3-day horizon
    const again = await mgr.post(`/v1/admin/outlets/${outlet.body.id}/slots/generate`).expect(200);
    expect(again.body.created).toBe(0);
    const slots = await mgr.get(`/v1/admin/outlets/${outlet.body.id}/slots?date=2026-11-01`).expect(200);
    expect(new Date(slots.body[0].startsAt).toISOString()).toBe('2026-11-01T09:00:00.000Z'); // 15:00 Dhaka
    await mgr.patch(`/v1/admin/outlets/${outlet.body.id}/slots/${slots.body[0].id}`).send({ status: 'CLOSED' }).expect(200);
    expect(await h.prisma.auditLog.count({ where: { action: { startsWith: 'delivery.' } } })).toBeGreaterThanOrEqual(5);
  });

  it('cannot lower slot capacity below existing bookings', async () => {
    const { outlet } = await codOrder(1);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const booked = await h.prisma.deliverySlot.findFirstOrThrow({ where: { bookedCount: 1 } });
    await mgr.patch(`/v1/admin/outlets/${outlet.id}/slots/${booked.id}`).send({ capacity: 1 }).expect(200);
    await h.prisma.deliverySlot.update({ where: { id: booked.id }, data: { capacity: 3 } });
    await h.prisma.$executeRaw`UPDATE delivery_slot SET booked_count = 2 WHERE id = ${booked.id}::uuid`;
    await mgr.patch(`/v1/admin/outlets/${outlet.id}/slots/${booked.id}`).send({ capacity: 1 }).expect(409);
  });
});

describe('notifications, reports, coupons and dashboard', () => {
  it('sends queued SMS through the job runner and stops at the daily cap', async () => {
    await codOrder(1);
    await runJobs();
    expect(h.sms.sent.filter((s) => s.text.includes('গ্রহণ করা হয়েছে'))).toHaveLength(1);
    const rec = await h.prisma.notificationRecord.findFirstOrThrow({ where: { template: 'order.placed' } });
    expect(rec.status).toBe('SENT');
    expect(rec.toMasked).toMatch(/^\+88018\*+11$/);
    expect(Buffer.from(rec.toEnc).toString('latin1')).not.toContain('01811111111');

    const notif = h.app.get(NotificationsService) as unknown as { env: { SMS_DAILY_CAP: number } };
    const cap = notif.env.SMS_DAILY_CAP;
    notif.env.SMS_DAILY_CAP = 1;
    try {
      await codOrder(1);
      await runJobs();
      const latest = await h.prisma.notificationRecord.findFirstOrThrow({ where: { template: 'order.placed' }, orderBy: { createdAt: 'desc' } });
      expect(latest).toMatchObject({ status: 'FAILED', lastError: 'Daily SMS cap reached' });
    } finally {
      notif.env.SMS_DAILY_CAP = cap;
    }
  });

  it('reports are outlet-scoped; CSV needs permission, is audited and formula-safe', async () => {
    const { outlet } = await codOrder(2);
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    const sales = await mgr.get('/v1/admin/reports/sales?from=2026-11-01&to=2026-11-01').expect(200);
    expect(sales.body.data).toEqual([expect.objectContaining({ orders: 1, grossPoisha: 36000, codOrders: 1 })]);
    await mgr.get('/v1/admin/reports/sales?format=csv').expect(403);
    const exporter = await staffAt(h, 'OUTLET_MANAGER', outlet.id, ['orders.export_csv']);
    const csv = await exporter.get('/v1/admin/reports/inventory?format=csv').expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(await h.prisma.auditLog.count({ where: { action: 'report.export_csv' } })).toBe(1);
    const { toCsv } = await import('../src/finance/finance.controller.js');
    expect(toCsv([{ a: '=HYPERLINK("x")', b: 'ok, "quoted"' }])).toBe('a,b\n"\'=HYPERLINK(""x"")","ok, ""quoted"""\n');
    const dash = await mgr.get('/v1/admin/dashboard').expect(200);
    expect(dash.body).toMatchObject({ todayOrders: 1, todayRevenuePoisha: 36000, openByStatus: { PLACED: 1 } });
  });

  it('coupons are Super Admin only and validated', async () => {
    const sa = await superAdmin(h);
    await sa.post('/v1/admin/coupons').send({ code: 'BAD', type: 'PERCENT', value: 20000 }).expect(400);
    const c = await sa.post('/v1/admin/coupons').send({ code: 'welcome50', type: 'FIXED', value: 5000, usageLimitPerCustomer: 1, active: true }).expect(201);
    expect(c.body.code).toBe('WELCOME50');
    await sa.post('/v1/admin/coupons').send({ code: 'WELCOME50', type: 'FIXED', value: 5000 }).expect(409);
    const outlet = await h.prisma.outlet.create({ data: { id: newId(), code: 'X1', nameBn: 'x', addressLine: 'x' } });
    const mgr = await staffAt(h, 'OUTLET_MANAGER', outlet.id);
    await mgr.get('/v1/admin/coupons').expect(403);
  });
});
