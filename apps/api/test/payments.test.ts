import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../src/common/crypto.js';
import { signSandboxBody } from '../src/payments/provider.js';
import { MaintenanceJob } from '../src/jobs/maintenance.js';
import { OrdersService } from '../src/orders/orders.service.js';
import { adminAgent, resetDb, startHarness, TEST_RAW_ENV, type Harness } from './support/harness.js';
import { bulk, customer, home, makeProduct, makeShop, postOrder, type CustomerAgent, type Shop } from './support/shop.js';

const SECRET = TEST_RAW_ENV.PAYMENTS_WEBHOOK_SECRET ?? 'dev-only-payments-webhook-secret-0123456789';
let h: Harness;
let shop: Shop;
let c: CustomerAgent;
beforeAll(async () => (h = await startHarness({ env: { PAYMENTS_PROVIDER: 'sandbox' } })));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
  shop = await makeShop(h, { separateCollection: true });
  c = await customer(h);
});

const line = (variantId: string, quantity = 1) => ({ variantId, quantity });
const inv = (variantId: string) => h.prisma.inventory.findUniqueOrThrow({ where: { outletId_productVariantId: { outletId: shop.collection.id, productVariantId: variantId } } });

async function placeBulk(qty = 20) {
  const { variant } = await makeProduct(h, { priceTaka: 50, stock: 100, outletId: shop.collection.id });
  const { body } = await postOrder(c, bulk([line(variant.id, qty)])).expect(201);
  return { variant, order: body as { id: string; orderNumber: string; totalPoisha: number; status: string; paymentStatus: string } };
}

/** What the gateway would post to our webhook. */
function webhook(event: Record<string, unknown>, opts: { secret?: string; tamper?: boolean } = {}) {
  const body = JSON.stringify(event);
  const sig = signSandboxBody(opts.secret ?? SECRET, body);
  const sent = opts.tamper ? body.replace('"PAID"', '"FAILED"').replace('"FAILED"', '"PAID"').replace(/"amountPoisha":\d+/, '"amountPoisha":1') : body;
  return request(h.app.getHttpServer()).post('/v1/webhooks/payments').set('content-type', 'application/json').set('x-dw-signature', sig).send(sent);
}

describe('bulk order placement', () => {
  it('goes to the Modina Market collection outlet, awaits payment and holds stock', async () => {
    const { variant, order } = await placeBulk();
    expect(order).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING', totalPoisha: 20 * 5_000 });
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.outletId).toBe(shop.collection.id);
    expect(row.bulkRuleSnapshot).toMatchObject({ minTotalQuantity: 20, approved: false });
    expect(await inv(variant.id)).toMatchObject({ reservedQuantity: 20 });
  });
  it('is unavailable until the collection outlet is configured', async () => {
    await h.prisma.setting.delete({ where: { key: 'bulk.collectionOutletId' } });
    const { variant } = await makeProduct(h, { priceTaka: 50, stock: 100, outletId: shop.outlet.id });
    const res = await postOrder(c, bulk([line(variant.id, 20)]));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BULK_NOT_CONFIGURED');
  });
  it('staff cannot mark it paid or move it forward before payment', async () => {
    const admin = await adminAgent(h);
    const { order } = await placeBulk();
    for (const s of ['PREPAID', 'PREPARING', 'COLLECTED']) {
      const r = await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: s });
      expect(r.status, s).toBe(409);
    }
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe('PENDING');
  });
});

describe('sandbox payment flow', () => {
  it('start -> signed success webhook -> PREPAID, then admin walks it to COLLECTED', async () => {
    const { variant, order } = await placeBulk();
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    expect(start.body).toMatchObject({ provider: 'sandbox', sandbox: true });
    const done = await c.post(`/v1/payments/sandbox/${start.body.merchantTranId}/complete`).send({ outcome: 'success' }).expect(200);
    expect(done.body.result).toBe('processed');
    const got = (await c.get(`/v1/orders/${order.id}`).expect(200)).body;
    expect(got).toMatchObject({ status: 'PREPAID', paymentStatus: 'PAID' });
    const pay = await h.prisma.payment.findUniqueOrThrow({ where: { id: start.body.paymentId } });
    expect(pay).toMatchObject({ status: 'PAID', paidAmountPoisha: order.totalPoisha });
    expect(pay.verifiedAt).not.toBeNull();
    const admin = await adminAgent(h);
    for (const s of ['PREPARING', 'READY_FOR_COLLECTION', 'COLLECTED']) await admin.patch(`/v1/admin/orders/${order.id}`).send({ status: s }).expect(200);
    expect(await inv(variant.id)).toMatchObject({ quantityOnHand: 80, reservedQuantity: 0 });
  });

  it('starting twice reuses the open attempt', async () => {
    const { order } = await placeBulk();
    const a = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    const b = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    expect(b.body.paymentId).toBe(a.body.paymentId);
    expect(await h.prisma.payment.count()).toBe(1);
  });

  it("another customer cannot pay for, or complete, someone else's order", async () => {
    const { order } = await placeBulk();
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    const other = await customer(h);
    expect((await other.post(`/v1/orders/${order.id}/payment`).send({})).status).toBe(404);
    expect((await other.post(`/v1/payments/sandbox/${start.body.merchantTranId}/complete`).send({ outcome: 'success' })).status).toBe(404);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT');
  });

  it('a failed payment leaves the order unpaid and retryable', async () => {
    const { order } = await placeBulk();
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    await c.post(`/v1/payments/sandbox/${start.body.merchantTranId}/complete`).send({ outcome: 'fail' }).expect(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT');
    const retry = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    expect(retry.body.paymentId).not.toBe(start.body.paymentId); // a new attempt
    expect(retry.body.merchantTranId).toBe(`${order.orderNumber}-2`);
    await c.post(`/v1/payments/sandbox/${retry.body.merchantTranId}/complete`).send({ outcome: 'success' }).expect(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PREPAID');
  });
});

describe('webhook security', () => {
  async function started() {
    const { order } = await placeBulk();
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    const event = (over: Record<string, unknown> = {}) => ({ eventId: `evt-${newId()}`, merchantTranId: start.body.merchantTranId, providerTranId: 'P-1', status: 'PAID', amountPoisha: order.totalPoisha, currency: 'BDT', ...over });
    return { order, start, event };
  }
  const status = async (id: string) => (await h.prisma.order.findUniqueOrThrow({ where: { id } })).status;

  it('rejects a missing, malformed, wrong-key or tampered signature and changes nothing', async () => {
    const { order, event } = await started();
    const body = JSON.stringify(event());
    const post = (sig?: string) => request(h.app.getHttpServer()).post('/v1/webhooks/payments').set('content-type', 'application/json').set(sig ? { 'x-dw-signature': sig } : {}).send(body);
    expect((await post()).status).toBe(401);
    expect((await post('nothex')).status).toBe(401);
    expect((await post(signSandboxBody('another-secret-another-secret-123456', body))).status).toBe(401);
    expect((await webhook(event(), { tamper: true })).status).toBe(401);
    expect(await status(order.id)).toBe('PENDING_PAYMENT');
    expect(await h.prisma.paymentEvent.count()).toBe(0);
    expect(await h.prisma.auditLog.count({ where: { action: 'payment.webhook_rejected' } })).toBeGreaterThanOrEqual(4);
  });

  it('is idempotent: a replayed event is acknowledged once and applied once', async () => {
    const { order, event } = await started();
    const e = event();
    expect((await webhook(e)).body.result).toBe('processed');
    expect((await webhook(e)).body.result).toBe('duplicate');
    expect(await h.prisma.paymentEvent.count()).toBe(1);
    expect(await h.prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'PREPAID' } })).toBe(1);
    expect(await status(order.id)).toBe('PREPAID');
  });

  it('a second success with a new event id does not double-count', async () => {
    const { order, event } = await started();
    await webhook(event({ eventId: 'evt-a' })).expect(200);
    const again = await webhook(event({ eventId: 'evt-b' })).expect(200);
    expect(again.body.result).toBe('processed');
    expect((await h.prisma.paymentEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: 'sandbox', providerEventId: 'evt-b' } } })).processingResult).toBe('already_settled');
    expect(await h.prisma.orderStatusEvent.count({ where: { orderId: order.id, toStatus: 'PREPAID' } })).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { action: 'payment.duplicate_capture' } })).toBe(1);
  });

  it('refuses to mark paid when the amount or currency differs', async () => {
    const { order, event } = await started();
    await webhook(event({ amountPoisha: order.totalPoisha - 1 })).expect(200);
    expect(await status(order.id)).toBe('PENDING_PAYMENT');
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    expect(pay).toMatchObject({ status: 'FAILED', failureCode: 'amount_mismatch' });
    expect(pay.verifiedAt).toBeNull();
    const { order: o2, event: ev2 } = await started();
    await webhook(ev2({ currency: 'USD' })).expect(200);
    expect(await status(o2.id)).toBe('PENDING_PAYMENT');
  });

  it('ignores events for unknown payments', async () => {
    const { event } = await started();
    const r = await webhook(event({ merchantTranId: 'NOPE-1' })).expect(200);
    expect(r.body.result).toBe('ignored');
  });

  it('a browser cannot mark an order paid: no unauthenticated path exists', async () => {
    const { order } = await started();
    const anon = request(h.app.getHttpServer());
    expect((await anon.post(`/v1/payments/sandbox/${order.orderNumber}-1/complete`).send({ outcome: 'success' })).status).toBeGreaterThanOrEqual(401);
    expect((await c.patch(`/v1/orders/${order.id}`).send({ status: 'PREPAID' })).status).toBe(404);
    expect(await status(order.id)).toBe('PENDING_PAYMENT');
  });
});

describe('payment window', () => {
  it('unpaid bulk orders expire: cancelled, stock released', async () => {
    const { variant, order } = await placeBulk();
    h.clock.advance(31 * 60_000); // hold is 30 min
    expect(await h.app.get(OrdersService).expireUnpaid()).toBe(1);
    expect(await h.app.get(OrdersService).expireUnpaid()).toBe(0); // idempotent
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row).toMatchObject({ status: 'CANCELLED', paymentStatus: 'FAILED' });
    expect(await inv(variant.id)).toMatchObject({ reservedQuantity: 0 });
  });
  it('does not expire an order that is still within the window or already paid', async () => {
    const { order } = await placeBulk();
    h.clock.advance(10 * 60_000);
    expect(await h.app.get(OrdersService).expireUnpaid()).toBe(0);
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    await c.post(`/v1/payments/sandbox/${start.body.merchantTranId}/complete`).send({ outcome: 'success' }).expect(200);
    h.clock.advance(60 * 60_000);
    expect(await h.app.get(OrdersService).expireUnpaid()).toBe(0);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PREPAID');
  });
  it('payment arriving after expiry is recorded for refund, the order stays cancelled', async () => {
    const { order } = await placeBulk();
    const start = await c.post(`/v1/orders/${order.id}/payment`).send({}).expect(200);
    h.clock.advance(31 * 60_000);
    await h.app.get(OrdersService).expireUnpaid();
    const r = await webhook({ eventId: 'late-1', merchantTranId: start.body.merchantTranId, providerTranId: 'P-9', status: 'PAID', amountPoisha: order.totalPoisha, currency: 'BDT' }).expect(200);
    expect(r.body.result).toBe('processed');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect(await h.prisma.auditLog.count({ where: { action: 'payment.refund_required' } })).toBe(1);
  });
  it('cannot start a payment after the window closed', async () => {
    const { order } = await placeBulk();
    h.clock.advance(31 * 60_000);
    expect((await c.post(`/v1/orders/${order.id}/payment`).send({})).status).toBe(409);
  });
  it('the maintenance cleanup runs without error', async () => {
    await placeBulk();
    expect(await h.app.get(MaintenanceJob).cleanup()).toMatchObject({ sessions: 0 });
  });
});

describe('non-bulk orders never need payment', () => {
  it('home delivery is PLACED with payment not required, and has no payment route', async () => {
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const { body } = await postOrder(c, home([line(variant.id)])).expect(201);
    expect(body).toMatchObject({ status: 'PLACED', paymentStatus: 'NOT_REQUIRED' });
    expect((await c.post(`/v1/orders/${body.id}/payment`).send({})).status).toBe(409);
  });
});
