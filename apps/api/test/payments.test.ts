import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JobsService } from '../src/jobs/jobs.service.js';
import { FakeGateway } from '../src/payments/fake-gateway.js';
import { PaymentGateway } from '../src/payments/gateway.js';
import { PaymentsService } from '../src/payments/payments.service.js';
import { resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';
import { checkoutFlow, customer, makeOutletReady, makeProduct, superAdmin } from './support/store.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

async function onlineOrder(stock = 5, qty = 1) {
  const { variants } = await makeProduct(h, [250]);
  const ready = await makeOutletReady(h, [variants[0]!.id], { stock });
  const c = await customer(h);
  await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: qty }).expect(200);
  const flow = await checkoutFlow(c, ready.areaId, 'ONLINE');
  return { c, ...ready, ...flow, variantId: variants[0]!.id };
}

/** Customer's browser on the simulator's hosted page. */
async function payOnSimulator(redirectUrl: string, outcome: 'SUCCESS' | 'FAILED' | 'CANCELLED') {
  const path = new URL(redirectUrl).pathname;
  const page = await request(h.app.getHttpServer()).get(path).expect(200);
  expect(page.text).toContain('SIMULATOR');
  const done = await request(h.app.getHttpServer()).post(`${path}/complete`).type('form').send({ outcome }).expect(303);
  return done.headers.location as string;
}

const runJobs = async () => {
  const jobs = h.app.get(JobsService);
  while ((await jobs.runOnce()) > 0);
};

describe('online payment', () => {
  it('marks PAID only after the server-side verification triggered by the IPN', async () => {
    const { c, placed } = await onlineOrder();
    expect(placed).toMatchObject({ status: 'PENDING_PAYMENT', next: 'REDIRECT' });
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    expect(init.body.redirectUrl).toContain('/v1/payments/simulator/');
    const back = await payOnSimulator(init.body.redirectUrl, 'SUCCESS');
    expect(back).toBe(`${TEST_ENV.WEB_ORIGIN}/checkout/return?order=${placed.orderId}&hint=success`);

    // The browser is back but the IPN has not been processed yet: still not paid.
    let st = await c.get(`/v1/orders/${placed.orderId}/payment-status`).expect(200);
    expect(st.body).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PENDING' });

    await runJobs(); // simulator delivers its signed IPN
    st = await c.get(`/v1/orders/${placed.orderId}/payment-status`).expect(200);
    expect(st.body).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: placed.orderId } });
    expect(pay).toMatchObject({ status: 'PAID', paidAmountPoisha: 31000 });
    expect(pay.verifiedAt).not.toBeNull();
    expect(await h.prisma.paymentEvent.count({ where: { paymentId: pay.id, kind: 'VERIFY_RESPONSE' } })).toBeGreaterThan(0);
  });

  it('ignores duplicate IPNs and rejects forged ones', async () => {
    const { c, placed } = await onlineOrder();
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: placed.orderId } });
    const gw = h.app.get(PaymentGateway) as FakeGateway;

    // Forged: claims success with no valid signature, before the customer paid.
    const forged = await request(h.app.getHttpServer())
      .post('/v1/webhooks/payments/fake')
      .set('x-simulator-signature', 'f'.repeat(64))
      .send({ merchantTranId: pay.merchantTranId, eventId: 'forged-1', status: 'SUCCESS' })
      .expect(200);
    expect(forged.body.result).toBe('REJECTED_SIGNATURE');
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('PENDING');

    // Validly signed but the gateway says not paid yet → still pending (callback alone never pays).
    const body = { merchantTranId: pay.merchantTranId, eventId: 'early-1' };
    const early = await request(h.app.getHttpServer()).post('/v1/webhooks/payments/fake').set('x-simulator-signature', gw.sign(JSON.stringify(body))).send(body).expect(200);
    expect(early.body.result).toBe('STILL_PENDING');

    await payOnSimulator(init.body.redirectUrl, 'SUCCESS');
    const body2 = { merchantTranId: pay.merchantTranId, eventId: 'real-1' };
    const sig = gw.sign(JSON.stringify(body2));
    const r1 = await request(h.app.getHttpServer()).post('/v1/webhooks/payments/fake').set('x-simulator-signature', sig).send(body2).expect(200);
    const r2 = await request(h.app.getHttpServer()).post('/v1/webhooks/payments/fake').set('x-simulator-signature', sig).send(body2).expect(200);
    expect([r1.body.result, r2.body.result]).toEqual(['PAID', 'DUPLICATE']);
    await runJobs(); // the simulator's own IPN arrives too — no change
    expect(await h.prisma.orderStatusEvent.count({ where: { orderId: placed.orderId, toStatus: 'PLACED' } })).toBe(1);
    await request(h.app.getHttpServer()).post('/v1/webhooks/payments/other-provider').send({}).expect(404);
  });

  it('never trusts the success URL; a failed payment can be retried', async () => {
    const { c, placed } = await onlineOrder();
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    await payOnSimulator(init.body.redirectUrl, 'FAILED');
    await runJobs();
    const st = await c.get(`/v1/orders/${placed.orderId}/payment-status`).expect(200);
    expect(st.body).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'FAILED' });
    const retry = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    await payOnSimulator(retry.body.redirectUrl, 'SUCCESS');
    await runJobs();
    const pays = await h.prisma.payment.findMany({ where: { orderId: placed.orderId }, orderBy: { createdAt: 'asc' } });
    expect(pays.map((p) => p.status)).toEqual(['FAILED', 'PAID']);
    expect(pays[1]!.merchantTranId).not.toBe(pays[0]!.merchantTranId);
  });

  it('refuses to mark paid when the gateway reports a different amount', async () => {
    const { c, placed } = await onlineOrder();
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: placed.orderId } });
    await payOnSimulator(init.body.redirectUrl, 'SUCCESS');
    await h.prisma.fakeGatewayTxn.update({ where: { merchantTranId: pay.merchantTranId }, data: { amountPoisha: 100 } });
    const result = await h.app.get(PaymentsService).verifyAndApply(pay.merchantTranId);
    expect(result).toBe('MISMATCH_AMOUNT_MISMATCH');
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe('PENDING');
  });

  it('expires unpaid orders after the hold, releasing stock and slot', async () => {
    const { c, placed, outlet } = await onlineOrder(5, 2);
    await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    expect((await h.prisma.inventory.findFirstOrThrow({ where: { outletId: outlet.id } })).reservedQuantity).toBe(2);
    h.clock.advance(14 * 60_000);
    await h.app.get(PaymentsService).expireAndReconcile();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } })).status).toBe('PENDING_PAYMENT');
    h.clock.advance(2 * 60_000);
    const r = await h.app.get(PaymentsService).expireAndReconcile();
    expect(r.expired).toBe(1);
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    expect(o.status).toBe('EXPIRED');
    expect((await h.prisma.inventory.findFirstOrThrow({ where: { outletId: outlet.id } })).reservedQuantity).toBe(0);
    expect((await h.prisma.deliverySlot.findUniqueOrThrow({ where: { id: o.deliverySlotId } })).bookedCount).toBe(0);
    await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(409);
  });

  it('a payment that completes just before expiry is caught by the final gateway check', async () => {
    const { c, placed } = await onlineOrder();
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    await payOnSimulator(init.body.redirectUrl, 'SUCCESS'); // IPN job not yet run
    h.clock.advance(16 * 60_000);
    await h.app.get(PaymentsService).expireAndReconcile();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } })).status).toBe('PLACED');
  });

  it('paid after expiry: re-reserves when possible, otherwise requests a refund', async () => {
    const a = await onlineOrder(1, 1);
    const init = await a.c.post(`/v1/payments/${a.placed.orderId}/initiate`).expect(200);
    const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: a.placed.orderId } });
    // The gateway is down at expiry time, so the hold expires.
    h.clock.advance(16 * 60_000);
    await h.prisma.payment.update({ where: { id: pay.id }, data: { status: 'CANCELLED' } });
    await h.app.get(PaymentsService).expireAndReconcile();
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: a.placed.orderId } })).status).toBe('EXPIRED');
    // Someone else buys the last unit meanwhile.
    const b = await customer(h);
    await b.put(`/v1/cart/items/${a.variantId}`).send({ quantity: 1 }).expect(200);
    await checkoutFlow(b, a.areaId, 'COD');
    // Now the late payment arrives.
    await payOnSimulator(init.body.redirectUrl, 'SUCCESS');
    await runJobs();
    const refund = await h.prisma.refund.findFirstOrThrow({ where: { paymentId: pay.id } });
    expect(refund).toMatchObject({ status: 'REQUESTED', amountPoisha: 31000 });
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: a.placed.orderId } })).status).toBe('EXPIRED');

    // Super Admin executes the refund through the gateway.
    const sa = await superAdmin(h);
    const ex = await sa.get('/v1/admin/reconciliation/exceptions').expect(200);
    expect(ex.body.refunds).toHaveLength(1);
    await sa.post(`/v1/admin/refunds/${refund.id}/execute`).expect(200);
    expect(await h.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).toMatchObject({ status: 'REFUNDED', refundedPoisha: 31000 });
    await sa.post(`/v1/admin/refunds/${refund.id}/execute`).expect(409);
  });

  it('cancelling a paid order creates a refund request (no money moves without Super Admin)', async () => {
    const { c, placed } = await onlineOrder();
    const init = await c.post(`/v1/payments/${placed.orderId}/initiate`).expect(200);
    await payOnSimulator(init.body.redirectUrl, 'SUCCESS');
    await runJobs();
    await c.post(`/v1/me/orders/${placed.orderId}/cancel`).send({ reason: 'no longer needed' }).expect(200);
    const refunds = await h.prisma.refund.findMany();
    expect(refunds).toHaveLength(1);
    expect(refunds[0]!.status).toBe('REQUESTED');
  });

  it('customer can switch an unpaid online order to COD when eligible', async () => {
    const { c, placed } = await onlineOrder();
    await c.post(`/v1/payments/${placed.orderId}/switch-to-cod`).expect(200);
    const o = await h.prisma.order.findUniqueOrThrow({ where: { id: placed.orderId }, include: { delivery: { include: { cod: true } } } });
    expect(o).toMatchObject({ status: 'PLACED', paymentMethod: 'COD', paymentStatus: 'UNPAID', paymentExpiresAt: null });
    expect(o.delivery?.cod?.expectedPoisha).toBe(o.totalPoisha);
  });

  it('limits simultaneous unpaid online orders per customer', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { stock: 20, capacity: 20 });
    const c = await customer(h);
    for (let i = 0; i < 2; i++) {
      await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
      await checkoutFlow(c, areaId, 'ONLINE');
    }
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const third = await checkoutFlow(c, areaId, 'ONLINE', { expect: 429 });
    expect(third.placed.error.code).toBe('RATE_LIMITED');
  });

  it('online payment can be switched off globally', async () => {
    const { variants } = await makeProduct(h, [100]);
    const { areaId } = await makeOutletReady(h, [variants[0]!.id], { onlineEnabled: false });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const q = await c.post('/v1/checkout/quote').send({ areaId }).expect(200);
    const pr = await c.post('/v1/checkout/price').send({ areaId, slotKey: q.body.slots[0].slotKey, paymentMethod: 'COD' }).expect(200);
    expect(pr.body.paymentMethods).toEqual(['COD']);
  });
});
