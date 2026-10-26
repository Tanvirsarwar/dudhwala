import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PaymentsService } from '../src/payments/payments.service.js';
import { mapStatus, SslCommerzGateway, type HttpFetch } from '../src/payments/sslcommerz-gateway.js';
import { HttpSmsSender } from '../src/auth/sms.js';
import { resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';
import { checkoutFlow, customer, makeOutletReady, makeProduct, superAdmin } from './support/store.js';

const STORE_ID = 'testbox';
const STORE_PASSWD = 'qwerty';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** In-memory stand-in for SSLCOMMERZ's sandbox HTTP API (shapes per its Node library and v4 docs). */
class MockSslCommerz {
  calls: { url: string; method: string; body: Record<string, string> }[] = [];
  txns = new Map<string, { status: string; amount: string; currency: string; bank_tran_id: string; val_id: string }>();
  refunds = new Map<string, string>();
  sessionStatus = 'SUCCESS';

  fetch: HttpFetch = async (url, init) => {
    const u = new URL(url);
    const body = Object.fromEntries(init?.body?.entries() ?? []);
    const q = Object.fromEntries(u.searchParams.entries());
    this.calls.push({ url, method: init?.method ?? 'GET', body });
    const json = (o: unknown) => ({ ok: true, status: 200, json: async () => o });
    const creds = { ...q, ...body };
    if (creds.store_id !== STORE_ID || creds.store_passwd !== STORE_PASSWD) return json({ status: 'FAILED', failedreason: 'Store Credential Error' });
    if (u.pathname === '/gwprocess/v4/api.php') {
      if (this.sessionStatus !== 'SUCCESS') return json({ status: 'FAILED', failedreason: 'Invalid data' });
      this.txns.set(body.tran_id!, { status: 'PENDING', amount: body.total_amount!, currency: body.currency!, bank_tran_id: '', val_id: '' });
      return json({ status: 'SUCCESS', sessionkey: `SK${body.tran_id}`, GatewayPageURL: `https://sandbox.sslcommerz.com/EasyCheckOut/test${body.tran_id}` });
    }
    if (u.pathname === '/validator/api/merchantTransIDvalidationAPI.php') {
      if (q.tran_id) {
        const t = this.txns.get(q.tran_id);
        return json({ APIConnect: 'DONE', no_of_trans_found: t ? 1 : 0, element: t ? [{ tran_id: q.tran_id, currency_type: t.currency, ...t }] : [] });
      }
      if (q.bank_tran_id) {
        const ref = `RR-${q.refe_id}`;
        this.refunds.set(ref, 'processing');
        return json({ APIConnect: 'DONE', bank_tran_id: q.bank_tran_id, trans_id: q.refe_id, refund_ref_id: ref, status: 'success', errorReason: '' });
      }
      if (q.refund_ref_id) return json({ APIConnect: 'DONE', refund_ref_id: q.refund_ref_id, status: this.refunds.get(q.refund_ref_id) ?? 'failed' });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  pay(tranId: string, opts: { amount?: string; currency?: string; status?: string } = {}) {
    const t = this.txns.get(tranId)!;
    Object.assign(t, { status: opts.status ?? 'VALID', bank_tran_id: `BANK${tranId}`, val_id: `VAL${tranId}` });
    if (opts.amount) t.amount = opts.amount;
    if (opts.currency) t.currency = opts.currency;
  }

  /** An IPN body signed the way SSLCOMMERZ's PHP integration verifies it. */
  ipn(tranId: string, overrides: Record<string, string> = {}) {
    const t = this.txns.get(tranId)!;
    const fields: Record<string, string> = { amount: t.amount, bank_tran_id: t.bank_tran_id, currency: t.currency, status: t.status, tran_id: tranId, val_id: t.val_id, ...overrides };
    const keys = Object.keys(fields).sort();
    const toSign: Record<string, string> = { ...fields, store_passwd: md5(STORE_PASSWD) };
    const sign = md5(Object.keys(toSign).sort().map((k) => `${k}=${toSign[k]}`).join('&'));
    return { ...fields, verify_key: keys.join(','), verify_sign: sign };
  }
}

const mock = new MockSslCommerz();
let h: Harness;
beforeAll(async () => {
  h = await startHarness({
    env: { PAYMENTS_PROVIDER: 'sslcommerz', SSLCOMMERZ_STORE_ID: STORE_ID, SSLCOMMERZ_STORE_PASSWORD: STORE_PASSWD },
    httpFetch: mock.fetch,
  });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  mock.calls = [];
  mock.sessionStatus = 'SUCCESS';
});

async function onlineOrder() {
  const { variants } = await makeProduct(h, [250]);
  const ready = await makeOutletReady(h, [variants[0]!.id], { stock: 5 });
  const c = await customer(h);
  await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
  const flow = await checkoutFlow(c, ready.areaId, 'ONLINE');
  const init = await c.post(`/v1/payments/${flow.placed.orderId}/initiate`).expect(200);
  const pay = await h.prisma.payment.findFirstOrThrow({ where: { orderId: flow.placed.orderId } });
  return { c, ready, orderId: flow.placed.orderId as string, init, tranId: pay.merchantTranId };
}

const ipnPost = (body: Record<string, string>) => request(h.app.getHttpServer()).post('/v1/webhooks/payments/sslcommerz').type('form').send(body);

describe('SSLCOMMERZ adapter', () => {
  it('creates a hosted session with the DB amount and our callback URLs', async () => {
    const { init, tranId, orderId } = await onlineOrder();
    expect(init.body.redirectUrl).toBe(`https://sandbox.sslcommerz.com/EasyCheckOut/test${tranId}`);
    const session = mock.calls.find((c) => c.url.endsWith('/gwprocess/v4/api.php'))!;
    expect(session.method).toBe('POST');
    expect(session.body).toMatchObject({ total_amount: '310.00', currency: 'BDT', tran_id: tranId, shipping_method: 'NO', product_profile: 'physical-goods' });
    expect(session.body.ipn_url).toBe(`${TEST_ENV.API_PUBLIC_URL}/v1/webhooks/payments/sslcommerz`);
    expect(session.body.success_url).toBe(`${TEST_ENV.API_PUBLIC_URL}/v1/webhooks/payments/sslcommerz/return?order=${orderId}&hint=success`);
  });

  it('pays only after the transaction query confirms VALID, amount and BDT', async () => {
    const { c, orderId, tranId } = await onlineOrder();
    // IPN arrives claiming VALID, but the gateway's query still says PENDING: not paid.
    const early = await ipnPost(mock.ipn(tranId, { status: 'VALID' })).expect(200);
    expect(early.body.result).toBe('STILL_PENDING');
    mock.pay(tranId);
    const ok = await ipnPost(mock.ipn(tranId)).expect(200);
    expect(ok.body.result).toBe('PAID');
    const st = await c.get(`/v1/orders/${orderId}/payment-status`).expect(200);
    expect(st.body).toMatchObject({ status: 'PLACED', paymentStatus: 'PAID' });
    const p = await h.prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(p).toMatchObject({ providerTranId: `BANK${tranId}`, paidAmountPoisha: 31000 });
    // Replay of the same IPN is a no-op.
    expect((await ipnPost(mock.ipn(tranId)).expect(200)).body.result).toBe('DUPLICATE');
  });

  it('rejects forged IPNs and never trusts their claims', async () => {
    const { orderId, tranId } = await onlineOrder();
    mock.pay(tranId);
    const forged = { ...mock.ipn(tranId), verify_sign: '0'.repeat(32) };
    expect((await ipnPost(forged).expect(200)).body.result).toBe('REJECTED_SIGNATURE');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PENDING');
    expect((await ipnPost({ tran_id: tranId, status: 'VALID' }).expect(200)).body.result).toBe('REJECTED_SIGNATURE');
  });

  it('refuses amount or currency mismatches reported by the gateway', async () => {
    const { tranId, orderId } = await onlineOrder();
    mock.pay(tranId, { amount: '10.00' });
    expect((await ipnPost(mock.ipn(tranId)).expect(200)).body.result).toBe('MISMATCH_AMOUNT_MISMATCH');
    mock.pay(tranId, { amount: '310.00', currency: 'USD' });
    expect((await ipnPost(mock.ipn(tranId, { val_id: 'other' })).expect(200)).body.result).toBe('MISMATCH_CURRENCY_MISMATCH');
    expect((await h.prisma.payment.findFirstOrThrow({ where: { orderId } })).status).toBe('PENDING');
  });

  it('turns the browser POST back into a redirect to the storefront and verifies', async () => {
    const { tranId, orderId } = await onlineOrder();
    mock.pay(tranId);
    const r = await request(h.app.getHttpServer())
      .post(`/v1/webhooks/payments/sslcommerz/return?order=${orderId}&hint=success`)
      .type('form')
      .send({ tran_id: tranId, status: 'VALID' })
      .expect(303);
    expect(r.headers.location).toBe(`${TEST_ENV.WEB_ORIGIN}/checkout/return?order=${orderId}&hint=success`);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).paymentStatus).toBe('PAID');
    const evil = await request(h.app.getHttpServer()).post('/v1/webhooks/payments/sslcommerz/return?order=https://evil.example&hint=x').type('form').send({}).expect(303);
    expect(evil.headers.location).toBe(`${TEST_ENV.WEB_ORIGIN}/checkout/return?order=&hint=unknown`);
  });

  it('reports gateway session failures as provider unavailable', async () => {
    mock.sessionStatus = 'FAILED';
    const { variants } = await makeProduct(h, [250]);
    const ready = await makeOutletReady(h, [variants[0]!.id], { stock: 5 });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variants[0]!.id}`).send({ quantity: 1 }).expect(200);
    const flow = await checkoutFlow(c, ready.areaId, 'ONLINE');
    const r = await c.post(`/v1/payments/${flow.placed.orderId}/initiate`).expect(502);
    expect(r.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
  });

  it('submits refunds and settles them when the gateway reports refunded', async () => {
    const { tranId, orderId, c } = await onlineOrder();
    mock.pay(tranId);
    await ipnPost(mock.ipn(tranId)).expect(200);
    await c.post(`/v1/me/orders/${orderId}/cancel`).send({ reason: 'changed my mind' }).expect(200);
    const refund = await h.prisma.refund.findFirstOrThrow({ where: { payment: { orderId } } });
    const sa = await superAdmin(h);
    const ex = await sa.post(`/v1/admin/refunds/${refund.id}/execute`).set('idempotency-key', crypto.randomUUID()).expect(200);
    expect(ex.body.status).toBe('SUBMITTED');
    const call = mock.calls.find((x) => x.url.includes('bank_tran_id='))!;
    expect(new URL(call.url).searchParams.get('refund_amount')).toBe('310.00');
    const payments = h.app.get(PaymentsService);
    expect(await payments.checkSubmittedRefunds()).toBe(0); // still processing
    mock.refunds.set(`RR-${tranId}`, 'refunded');
    expect(await payments.checkSubmittedRefunds()).toBe(1);
    const p = await h.prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect(p).toMatchObject({ status: 'REFUNDED', refundedPoisha: 31000 });
  });

  it('maps gateway statuses conservatively', () => {
    expect(['VALID', 'VALIDATED'].map(mapStatus)).toEqual(['SUCCESS', 'SUCCESS']);
    expect(['FAILED', 'CANCELLED', 'EXPIRED', 'PENDING', 'UNATTEMPTED', 'WHATEVER'].map(mapStatus)).toEqual(['FAILED', 'CANCELLED', 'CANCELLED', 'PENDING', 'PENDING', 'PENDING']);
    expect(h.app.get(PaymentsService).providerCode).toBe('sslcommerz');
    expect(SslCommerzGateway).toBeDefined();
  });
});

describe('HTTP SMS adapter', () => {
  const cfg = { url: 'https://sms.example/api', method: 'GET' as const, staticParams: 'api_key=K&senderid=S', toParam: 'number', textParam: 'message', phoneFormat: '880' as const, successPattern: '"response_code":\\s*202' };
  it('sends Bangla text with configured parameter names and phone format', async () => {
    let seen = '';
    const s = new HttpSmsSender(cfg, async (url) => {
      seen = url;
      return { ok: true, status: 200, text: async () => '{"response_code": 202}' };
    });
    await s.send('+8801712345678', 'দুধওয়ালা কোড ১২৩');
    const u = new URL(seen);
    expect(u.searchParams.get('number')).toBe('8801712345678');
    expect(u.searchParams.get('message')).toBe('দুধওয়ালা কোড ১২৩');
    expect(u.searchParams.get('api_key')).toBe('K');
    expect(HttpSmsSender.formatPhone('+8801712345678', '0')).toBe('01712345678');
  });
  it('throws without leaking the API key when the provider rejects', async () => {
    const s = new HttpSmsSender(cfg, async () => ({ ok: true, status: 200, text: async () => '{"response_code": 1001}' }));
    await expect(s.send('+8801712345678', 'x')).rejects.toThrow(/rejected message for \+88017\*+78/);
    await expect(s.send('+8801712345678', 'x')).rejects.not.toThrow(/api_key|K&/);
  });
});
