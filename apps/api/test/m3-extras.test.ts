import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { totpAt } from '../src/auth/totp.js';
import { JobsService, JOB_POLICY, backoffMs } from '../src/jobs/jobs.service.js';
import { MaintenanceJob, MAINTENANCE_JOB } from '../src/jobs/maintenance.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { createSuperAdmin } from '../src/cli/create-super-admin.js';
import { resetMfa } from '../src/cli/reset-mfa.js';
import { newId } from '../src/common/crypto.js';
import { browser, CapturingSms, loginStaff, makeOutlet, makeStaff, PASSWORD, resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => resetDb(h.prisma));

describe('per-IP rate limits (shared in PostgreSQL)', () => {
  it('blocks the 31st staff login attempt per IP per hour, then resets', async () => {
    const agent = await browser(h.app);
    for (let i = 0; i < 30; i++) await agent.post('/v1/auth/staff/login').send({ login: `nobody${i}@test.local`, password: 'x' }).expect(401);
    const r = await agent.post('/v1/auth/staff/login').send({ login: 'nobody@test.local', password: 'x' }).expect(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    h.clock.advance(3_600_000);
    await agent.post('/v1/auth/staff/login').send({ login: 'nobody@test.local', password: 'x' }).expect(401);
  });

  it('counts across API instances', async () => {
    const other = await createApp(TEST_ENV, { clock: h.clock, sms: new CapturingSms() });
    await other.init();
    try {
      const a = await browser(h.app);
      const b = await browser(other);
      for (let i = 0; i < 15; i++) await a.post('/v1/auth/staff/login').send({ login: 'x@test.local', password: 'x' });
      for (let i = 0; i < 15; i++) await b.post('/v1/auth/staff/login').send({ login: 'x@test.local', password: 'x' });
      await a.post('/v1/auth/staff/login').send({ login: 'x@test.local', password: 'x' }).expect(429);
    } finally {
      await other.close();
    }
  });
});

describe('TOTP replay across instances', () => {
  it('rejects a code already used on another API instance', async () => {
    const other = await createApp(TEST_ENV, { clock: h.clock, sms: new CapturingSms() });
    await other.init();
    try {
      const sa = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
      const a = await browser(h.app);
      const b = await browser(other);
      await a.post('/v1/auth/staff/login').send({ login: sa.email, password: PASSWORD }).expect(200);
      await b.post('/v1/auth/staff/login').send({ login: sa.email, password: PASSWORD }).expect(200);
      const code = totpAt(sa.secret, h.clock.now());
      await a.post('/v1/auth/staff/mfa').send({ code }).expect(204);
      await b.post('/v1/auth/staff/mfa').send({ code }).expect(401);
      h.clock.advance(30_000);
      await b.post('/v1/auth/staff/mfa').send({ code: totpAt(sa.secret, h.clock.now()) }).expect(204);
    } finally {
      await other.close();
    }
  });
});

describe('settings', () => {
  it('returns safe defaults and validates writes', async () => {
    const sa = await loginStaff(h, await makeStaff(h.prisma, 'SUPER_ADMIN', null));
    const list = await sa.get('/v1/admin/settings').expect(200);
    const online = list.body.find((s: { key: string }) => s.key === 'payments.online.enabled');
    expect(online).toMatchObject({ value: false, isDefault: true });
    await sa.put('/v1/admin/settings/payments.holdMinutes').send({ value: 20 }).expect(204);
    expect(await h.app.get(SettingsService).get('payments.holdMinutes')).toBe(20);
    await sa.put('/v1/admin/settings/payments.holdMinutes').send({ value: 2 }).expect(400);
    await sa.put('/v1/admin/settings/no.such.key').send({ value: 1 }).expect(400);
    expect(await h.prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(1);
  });

  it('lets a manager change only their own outlet-scoped settings', async () => {
    const A = await makeOutlet(h.prisma);
    const B = await makeOutlet(h.prisma);
    const mgr = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_MANAGER', A.id));
    await mgr.put(`/v1/admin/outlets/${A.id}/settings/orders.lateAfterMinutes`).send({ value: 30 }).expect(204);
    await mgr.put(`/v1/admin/outlets/${B.id}/settings/orders.lateAfterMinutes`).send({ value: 30 }).expect(404);
    await mgr.put(`/v1/admin/outlets/${A.id}/settings/payments.holdMinutes`).send({ value: 20 }).expect(400);
    await mgr.put('/v1/admin/settings/payments.holdMinutes').send({ value: 20 }).expect(403);
    const svc = h.app.get(SettingsService);
    expect(await svc.get('orders.lateAfterMinutes', A.id)).toBe(30);
    expect(await svc.get('orders.lateAfterMinutes', B.id)).toBe(15);
  });
});

describe('job runner', () => {
  it('runs due jobs once, retries failures with back-off, then fails permanently', async () => {
    const jobs = h.app.get(JobsService);
    const seen: string[] = [];
    let failures = 0;
    const okType = `test.ok.${newId()}`;
    jobs.register(okType, async () => void seen.push('ok'));
    const failType = `test.fail.${newId()}`;
    jobs.register(failType, async () => {
      failures++;
      throw new Error('boom');
    });
    await jobs.enqueue(okType, {});
    const failId = await jobs.enqueue(failType, {});
    await jobs.enqueue(okType, {}, { runAt: new Date(h.clock.now().getTime() + 60_000) }); // not due

    expect(await jobs.runOnce()).toBe(2);
    expect(seen).toEqual(['ok']);
    let row = await h.prisma.job.findUniqueOrThrow({ where: { id: failId } });
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'boom' });
    expect(row.runAt.getTime() - h.clock.now().getTime()).toBe(backoffMs(1));

    for (let i = 1; i < JOB_POLICY.maxAttempts; i++) {
      h.clock.advance(3_600_000);
      await jobs.runOnce();
    }
    row = await h.prisma.job.findUniqueOrThrow({ where: { id: failId } });
    expect(row.status).toBe('FAILED');
    expect(failures).toBe(JOB_POLICY.maxAttempts);
  });

  it('never runs the same job on two instances concurrently', async () => {
    const other = await createApp(TEST_ENV, { clock: h.clock, sms: new CapturingSms() });
    await other.init();
    try {
      const a = h.app.get(JobsService);
      const b = other.get(JobsService);
      const type = `test.count.${newId()}`;
      let runs = 0;
      const handler = async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 20));
      };
      a.register(type, handler);
      b.register(type, handler);
      for (let i = 0; i < 25; i++) await a.enqueue(type, { i });
      let done = 0;
      while (done < 25) {
        const [x, y] = await Promise.all([a.runOnce(), b.runOnce()]);
        done += x + y;
        if (x + y === 0) break;
      }
      expect(runs).toBe(25);
      expect(await h.prisma.job.count({ where: { type, status: 'DONE' } })).toBe(25);
    } finally {
      await other.close();
    }
  });

  it('recovers a job whose worker crashed (stale lock)', async () => {
    const jobs = h.app.get(JobsService);
    const type = `test.stale.${newId()}`;
    let ran = 0;
    jobs.register(type, async () => void ran++);
    const id = await jobs.enqueue(type, {});
    await h.prisma.job.update({ where: { id }, data: { status: 'RUNNING', lockedAt: h.clock.now(), lockedBy: 'dead-worker', attempts: 1 } });
    expect(await jobs.runOnce()).toBe(0);
    h.clock.advance(JOB_POLICY.staleLockMs + 1);
    expect(await jobs.runOnce()).toBe(1);
    expect(ran).toBe(1);
  });

  it('maintenance removes old sessions and reschedules itself', async () => {
    const staff = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
    await h.prisma.session.create({
      data: { id: newId(), userId: staff.user.id, tokenHash: 'a'.repeat(64), kind: 'STAFF', expiresAt: new Date(h.clock.now().getTime() - 40 * 86_400_000) },
    });
    const m = h.app.get(MaintenanceJob);
    await m.scheduleNext();
    await m.scheduleNext();
    expect(await h.prisma.job.count({ where: { type: MAINTENANCE_JOB, status: 'PENDING' } })).toBe(1);
    h.clock.advance(3_600_001);
    await h.app.get(JobsService).runOnce();
    expect(await h.prisma.session.count()).toBe(0);
    expect(await h.prisma.job.count({ where: { type: MAINTENANCE_JOB, status: 'PENDING' } })).toBe(1);
  });
});

describe('catalogue admin', () => {
  it('creates a draft product and publishes it with approval recorded', async () => {
    const sa = await loginStaff(h, await makeStaff(h.prisma, 'SUPER_ADMIN', null));
    const cat = await sa.post('/v1/admin/categories').send({ slug: 'milk', nameBn: 'দুধ' }).expect(201);
    const prod = await sa.post('/v1/admin/products').send({ categoryId: cat.body.id, slug: 'cow-milk', nameBn: 'TEST গরুর দুধ' }).expect(201);
    expect(prod.body.status).toBe('DRAFT');
    await sa.post(`/v1/admin/products/${prod.body.id}/publish`).expect(400); // no variants yet
    const v = await sa
      .post(`/v1/admin/products/${prod.body.id}/variants`)
      .send({ sku: 'TEST-MILK-1L', labelBn: '১ লিটার', packSize: 1, packUnit: 'L', pricePoisha: 9000 })
      .expect(201);
    const pub = await sa.post(`/v1/admin/products/${prod.body.id}/publish`).expect(200);
    expect(pub.body.status).toBe('ACTIVE');
    expect(pub.body.contentApprovedBy).toBeTruthy();
    expect((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: v.body.id } })).status).toBe('ACTIVE');

    // Editing content withdraws approval.
    const edit = await sa.patch(`/v1/admin/products/${prod.body.id}`).send({ descriptionBn: 'নতুন বর্ণনা' }).expect(200);
    expect(edit.body).toMatchObject({ status: 'DRAFT', contentApprovedBy: null });
  });

  it('audits price changes and validates compare-at price', async () => {
    const sa = await loginStaff(h, await makeStaff(h.prisma, 'SUPER_ADMIN', null));
    const cat = await sa.post('/v1/admin/categories').send({ slug: 'ghee', nameBn: 'ঘি' }).expect(201);
    const prod = await sa.post('/v1/admin/products').send({ categoryId: cat.body.id, slug: 'ghee-1', nameBn: 'TEST ঘি' }).expect(201);
    await sa.post(`/v1/admin/products/${prod.body.id}/variants`).send({ sku: 'TEST-G', labelBn: 'x', packSize: 1, packUnit: 'KG', pricePoisha: 100, compareAtPoisha: 90 }).expect(400);
    const v = await sa.post(`/v1/admin/products/${prod.body.id}/variants`).send({ sku: 'TEST-G', labelBn: 'x', packSize: 1, packUnit: 'KG', pricePoisha: 100 }).expect(201);
    await sa.patch(`/v1/admin/variants/${v.body.id}`).send({ pricePoisha: 120 }).expect(200);
    const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'catalog.price_change' } });
    expect(log.before).toMatchObject({ pricePoisha: 100 });
    await sa.post(`/v1/admin/products/${prod.body.id}/variants`).send({ sku: 'TEST-G', labelBn: 'x', packSize: 1, packUnit: 'KG', pricePoisha: 100 }).expect(409);
    await sa.patch(`/v1/admin/variants/${v.body.id}`).send({ pricePoisha: 100.5 }).expect(400);
  });

  it('lets outlet roles read but not change the catalogue', async () => {
    const A = await makeOutlet(h.prisma);
    const mgr = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_MANAGER', A.id));
    await mgr.get('/v1/admin/products').expect(200);
    await mgr.post('/v1/admin/categories').send({ slug: 'x', nameBn: 'x' }).expect(403);
    const rider = await loginStaff(h, await makeStaff(h.prisma, 'DELIVERY_STAFF', A.id));
    await rider.get('/v1/admin/products').expect(403);
  });
});

describe('create-super-admin CLI', () => {
  it('creates an admin who must enrol 2FA before any admin action', async () => {
    await createSuperAdmin(h.prisma, { email: 'Owner@Example.com', name: 'Owner', password: 'a-long-enough-password' });
    await expect(createSuperAdmin(h.prisma, { email: 'owner@example.com', name: 'Owner', password: 'a-long-enough-password' })).rejects.toThrow(/already exists/);
    await expect(createSuperAdmin(h.prisma, { email: 'x@example.com', name: 'X', password: 'short' })).rejects.toThrow();
    const agent = await browser(h.app);
    const login = await agent.post('/v1/auth/staff/login').send({ login: 'owner@example.com', password: 'a-long-enough-password' }).expect(200);
    expect(login.body).toEqual({ mfaRequired: true, mfaEnrolled: false });
    await agent.get('/v1/admin/outlets').expect(401);
    expect(await h.prisma.auditLog.count({ where: { action: 'staff.super_admin_created' } })).toBe(1);
  });
});

describe('health', () => {
  it('stays public', async () => {
    await request(h.app.getHttpServer()).get('/v1/health/live').expect(200);
  });
});

describe('reset-mfa CLI', () => {
  it('clears two-factor for a staff account and ends sessions', async () => {
    const sa = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
    const agent = await loginStaff(h, sa);
    await resetMfa(h.prisma, sa.email.toUpperCase());
    await agent.get('/v1/admin/outlets').expect(401);
    const u = await h.prisma.user.findUniqueOrThrow({ where: { id: sa.user.id } });
    expect(u).toMatchObject({ mfaEnabled: false, mfaTotpSecretEnc: null });
    await expect(resetMfa(h.prisma, 'nobody@example.com')).rejects.toThrow(/No staff account/);
  });
});
