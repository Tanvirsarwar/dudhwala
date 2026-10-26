import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, loginStaff, makeOutlet, makeStaff, makeVariant, resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';

/**
 * Authorization matrix (QA_TEST_PLAN §4) for every outlet-scoped route built so far.
 * Rows: caller. Columns: target outlet A (own) vs B (foreign).
 */
let h: Harness;
let A: { id: string };
let B: { id: string };
let variantId: string;
type Agent = Awaited<ReturnType<typeof browser>>;
const agents: Record<string, Agent> = {};

beforeAll(async () => {
  h = await startHarness();
  await resetDb(h.prisma);
  A = await makeOutlet(h.prisma, 'OUT-A');
  B = await makeOutlet(h.prisma, 'OUT-B');
  variantId = (await makeVariant(h.prisma)).id;
  agents.sa = await loginStaff(h, await makeStaff(h.prisma, 'SUPER_ADMIN', null));
  agents.mgrA = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_MANAGER', A.id));
  agents.staffA = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_STAFF', A.id));
  agents.staffAPlus = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_STAFF', A.id, { extraPermissions: ['inventory.adjust', 'inventory.receive'] }));
  agents.riderA = await loginStaff(h, await makeStaff(h.prisma, 'DELIVERY_STAFF', A.id));
  const cust = await browser(h.app, TEST_ENV.WEB_ORIGIN);
  const r = await cust.post('/v1/auth/otp/request').send({ phone: '01712345678' });
  await cust.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
  agents.customer = cust;
  agents.anon = await browser(h.app);
  // Seed stock at both outlets through the API as Super Admin.
  for (const o of [A, B]) await agents.sa.post(`/v1/admin/outlets/${o.id}/inventory/receive`).send({ variantId, qty: 10 }).expect(201);
});
afterAll(async () => h.close());

const routes = (o: string) => ({
  getOutlet: { m: 'get', url: `/v1/admin/outlets/${o}` },
  listInventory: { m: 'get', url: `/v1/admin/outlets/${o}/inventory` },
  movements: { m: 'get', url: `/v1/admin/outlets/${o}/inventory/movements` },
  receive: { m: 'post', url: `/v1/admin/outlets/${o}/inventory/receive`, body: () => ({ variantId, qty: 1 }) },
  adjust: { m: 'post', url: `/v1/admin/outlets/${o}/inventory/adjust`, body: () => ({ variantId, deltaQty: 1, reason: 'count fix' }) },
  writeOff: { m: 'post', url: `/v1/admin/outlets/${o}/inventory/write-off`, body: () => ({ variantId, qty: 1, reason: 'damaged' }) },
  listStaff: { m: 'get', url: `/v1/admin/outlets/${o}/staff` },
});
type RouteKey = keyof ReturnType<typeof routes>;

// Expected status per caller × route for OWN outlet (A). Foreign outlet (B) for any outlet role is always 404.
const OWN: Record<string, Record<RouteKey, number>> = {
  sa: { getOutlet: 200, listInventory: 200, movements: 200, receive: 201, adjust: 201, writeOff: 201, listStaff: 200 },
  mgrA: { getOutlet: 200, listInventory: 200, movements: 200, receive: 201, adjust: 201, writeOff: 201, listStaff: 200 },
  staffA: { getOutlet: 200, listInventory: 200, movements: 200, receive: 403, adjust: 403, writeOff: 403, listStaff: 403 },
  staffAPlus: { getOutlet: 200, listInventory: 200, movements: 200, receive: 201, adjust: 201, writeOff: 403, listStaff: 403 },
  riderA: { getOutlet: 200, listInventory: 403, movements: 403, receive: 403, adjust: 403, writeOff: 403, listStaff: 403 },
  customer: { getOutlet: 403, listInventory: 403, movements: 403, receive: 403, adjust: 403, writeOff: 403, listStaff: 403 },
  anon: { getOutlet: 401, listInventory: 401, movements: 401, receive: 401, adjust: 401, writeOff: 401, listStaff: 401 },
};

async function call(agent: Agent, r: { m: string; url: string; body?: () => object }) {
  return r.m === 'get' ? agent.get(r.url) : agent.post(r.url).send(r.body?.() ?? {});
}

describe('authorization matrix', () => {
  for (const [caller, expectations] of Object.entries(OWN)) {
    for (const [route, status] of Object.entries(expectations) as [RouteKey, number][]) {
      it(`${caller} → own/${route} = ${status}`, async () => {
        const res = await call(agents[caller] as Agent, routes(A.id)[route]);
        expect(res.status).toBe(status);
      });
      const foreign = ['mgrA', 'staffA', 'staffAPlus', 'riderA'].includes(caller) ? (status === 403 ? 403 : 404) : caller === 'sa' ? status : status;
      it(`${caller} → foreign/${route} = ${foreign}`, async () => {
        const res = await call(agents[caller] as Agent, routes(B.id)[route]);
        expect(res.status).toBe(foreign);
        if (foreign === 404) expect(JSON.stringify(res.body)).not.toContain('OUT-B');
      });
    }
  }

  it('outlet list for a manager contains only their outlet', async () => {
    const r = await (agents.mgrA as Agent).get('/v1/admin/outlets').expect(200);
    expect(r.body.map((o: { code: string }) => o.code)).toEqual(['OUT-A']);
    const all = await (agents.sa as Agent).get('/v1/admin/outlets').expect(200);
    expect(all.body.map((o: { code: string }) => o.code)).toEqual(['OUT-A', 'OUT-B']);
  });

  it('only Super Admin can create outlets', async () => {
    const body = { code: 'NEW-1', nameBn: 'নতুন', addressLine: 'TEST' };
    await (agents.mgrA as Agent).post('/v1/admin/outlets').send(body).expect(403);
    const r = await (agents.sa as Agent).post('/v1/admin/outlets').send(body).expect(201);
    expect(r.body.status).toBe('PAUSED');
    expect(r.body.acceptsOnlineOrders).toBe(false);
  });

  it('rejects mass-assignment of server-owned fields', async () => {
    const r = await (agents.sa as Agent).post('/v1/admin/outlets').send({ code: 'NEW-2', nameBn: 'x', addressLine: 'y', status: 'ACTIVE' }).expect(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a manager cannot create staff unless granted, and never managers', async () => {
    const body = { fullName: 'Rider', email: 'r1@test.local', role: 'DELIVERY_STAFF', temporaryPassword: 'temporary-pass-123' };
    await (agents.mgrA as Agent).post(`/v1/admin/outlets/${A.id}/staff`).send(body).expect(403);
    const mgrPlus = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_MANAGER', A.id, { extraPermissions: ['staff.manage_outlet'] }));
    await mgrPlus.post(`/v1/admin/outlets/${A.id}/staff`).send(body).expect(201);
    await mgrPlus.post(`/v1/admin/outlets/${A.id}/staff`).send({ ...body, email: 'm2@test.local', role: 'OUTLET_MANAGER' }).expect(403);
    await mgrPlus.post(`/v1/admin/outlets/${B.id}/staff`).send({ ...body, email: 'r2@test.local' }).expect(404);
    await mgrPlus
      .post(`/v1/admin/outlets/${A.id}/staff`)
      .send({ ...body, email: 'r3@test.local', extraPermissions: ['payments.refund'] })
      .expect(400);
  });

  it('a staff member cannot be assigned to a second outlet', async () => {
    const s = await makeStaff(h.prisma, 'OUTLET_STAFF', A.id);
    const role = await h.prisma.role.findUniqueOrThrow({ where: { code: 'OUTLET_STAFF' } });
    await expect(
      h.prisma.outletStaff.create({ data: { id: crypto.randomUUID(), userId: s.user.id, outletId: B.id, roleId: role.id, grantedById: s.user.id } }),
    ).rejects.toThrow();
  });

  it('never exposes password hashes or TOTP secrets', async () => {
    const r = await (agents.sa as Agent).get(`/v1/admin/outlets/${A.id}/staff`).expect(200);
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/argon2|passwordHash|mfaTotpSecret/);
  });
});
