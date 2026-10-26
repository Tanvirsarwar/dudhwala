import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpAt } from '../src/auth/totp.js';
import { browser, loginStaff, makeOutlet, makeStaff, PASSWORD, resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.sms.sent = [];
});

describe('customer phone OTP', () => {
  it('registers and logs in a customer, normalising Bangla digits', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    const r = await agent.post('/v1/auth/otp/request').send({ phone: '০১৭১২৩৪৫৬৭৮' }).expect(200);
    expect(h.sms.sent[0]?.to).toBe('+8801712345678');
    const v = await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
    expect(v.body.isNew).toBe(true);
    const me = await agent.get('/v1/me').expect(200);
    expect(me.body.role).toBe('CUSTOMER');
    expect(me.body.user.phone).toBe('+8801712345678');
  });

  it('stores only a hash of the code', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    const r = await agent.post('/v1/auth/otp/request').send({ phone: '01712345678' }).expect(200);
    const row = await h.prisma.otpChallenge.findUniqueOrThrow({ where: { id: r.body.challengeId } });
    expect(row.codeHash).not.toContain(h.sms.lastCode());
  });

  it('enforces resend wait and hourly limit', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    await agent.post('/v1/auth/otp/request').send({ phone: '01812345678' }).expect(200);
    const again = await agent.post('/v1/auth/otp/request').send({ phone: '01812345678' }).expect(429);
    expect(again.headers['retry-after']).toBeDefined();
    for (let i = 0; i < 4; i++) {
      h.clock.advance(61_000);
      await agent.post('/v1/auth/otp/request').send({ phone: '01812345678' }).expect(200);
    }
    h.clock.advance(61_000);
    await agent.post('/v1/auth/otp/request').send({ phone: '01812345678' }).expect(429);
  });

  it('locks a challenge after 5 wrong attempts, even with the right code after', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    const r = await agent.post('/v1/auth/otp/request').send({ phone: '01912345678' }).expect(200);
    const good = h.sms.lastCode();
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: bad }).expect(401);
    const last = await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: good }).expect(401);
    expect(last.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rejects expired codes and code reuse', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    const r = await agent.post('/v1/auth/otp/request').send({ phone: '01512345678' }).expect(200);
    const code = h.sms.lastCode();
    h.clock.advance(5 * 60_000 + 1);
    await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code }).expect(401);

    h.clock.advance(60_000);
    const r2 = await agent.post('/v1/auth/otp/request').send({ phone: '01512345678' }).expect(200);
    const code2 = h.sms.lastCode();
    await agent.post('/v1/auth/otp/verify').send({ challengeId: r2.body.challengeId, code: code2 }).expect(200);
    await agent.post('/v1/auth/otp/verify').send({ challengeId: r2.body.challengeId, code: code2 }).expect(401);
  });

  it('rejects invalid phone numbers', async () => {
    const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    const r = await agent.post('/v1/auth/otp/request').send({ phone: '+441234567890' }).expect(400);
    expect(h.sms.sent).toHaveLength(0);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('CSRF and origin', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const r = await request(h.app.getHttpServer()).post('/v1/auth/otp/request').send({ phone: '01712345678' }).expect(403);
    expect(r.body.error.message).toMatch(/CSRF/);
  });
  it('rejects a forged token and unknown origins', async () => {
    const agent = await browser(h.app);
    await agent.post('/v1/auth/otp/request').set('x-csrf-token', 'abc.def').send({ phone: '01712345678' }).expect(403);
    await agent.post('/v1/auth/otp/request').set('origin', 'https://evil.example').send({ phone: '01712345678' }).expect(403);
  });
});

describe('staff login and MFA', () => {
  it('requires TOTP for managers before any permissioned route', async () => {
    const outlet = await makeOutlet(h.prisma);
    const mgr = await makeStaff(h.prisma, 'OUTLET_MANAGER', outlet.id);
    const agent = await browser(h.app);
    const login = await agent.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD }).expect(200);
    expect(login.body).toEqual({ mfaRequired: true, mfaEnrolled: true });
    const blocked = await agent.get(`/v1/admin/outlets/${outlet.id}`).expect(401);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    await agent.post('/v1/auth/staff/mfa').send({ code: '000000' }).expect(401);
    await agent.post('/v1/auth/staff/mfa').send({ code: totpAt(mgr.secret, h.clock.now()) }).expect(204);
    await agent.get(`/v1/admin/outlets/${outlet.id}`).expect(200);
  });

  it('rejects TOTP replay of the same code', async () => {
    const sa = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
    const a1 = await browser(h.app);
    await a1.post('/v1/auth/staff/login').send({ login: sa.email, password: PASSWORD }).expect(200);
    const code = totpAt(sa.secret, h.clock.now());
    await a1.post('/v1/auth/staff/mfa').send({ code }).expect(204);
    const a2 = await browser(h.app);
    await a2.post('/v1/auth/staff/login').send({ login: sa.email, password: PASSWORD }).expect(200);
    await a2.post('/v1/auth/staff/mfa').send({ code }).expect(401);
  });

  it('lets an unenrolled manager only enrol, then works after enrolment', async () => {
    const outlet = await makeOutlet(h.prisma);
    const mgr = await makeStaff(h.prisma, 'OUTLET_MANAGER', outlet.id, { withMfa: false });
    const agent = await browser(h.app);
    const login = await agent.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD }).expect(200);
    expect(login.body).toEqual({ mfaRequired: true, mfaEnrolled: false });
    await agent.get(`/v1/admin/outlets/${outlet.id}/inventory`).expect(401);
    const e = await agent.post('/v1/auth/staff/mfa/enroll').expect(200);
    expect(e.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const c = await agent.post('/v1/auth/staff/mfa/confirm').send({ code: totpAt(e.body.secret, h.clock.now()) }).expect(200);
    expect(c.body.recoveryCodes).toHaveLength(10);
    await agent.get(`/v1/admin/outlets/${outlet.id}/inventory`).expect(200);
    const stored = await h.prisma.user.findUniqueOrThrow({ where: { id: mgr.user.id } });
    expect(Buffer.from(stored.mfaTotpSecretEnc ?? []).toString('latin1')).not.toContain(e.body.secret);
  });

  it('accepts a recovery code exactly once', async () => {
    const outlet = await makeOutlet(h.prisma);
    const mgr = await makeStaff(h.prisma, 'OUTLET_MANAGER', outlet.id, { withMfa: false });
    const a = await browser(h.app);
    await a.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD }).expect(200);
    const e = await a.post('/v1/auth/staff/mfa/enroll').expect(200);
    const { body } = await a.post('/v1/auth/staff/mfa/confirm').send({ code: totpAt(e.body.secret, h.clock.now()) }).expect(200);
    const rc = body.recoveryCodes[0] as string;
    const b = await browser(h.app);
    await b.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD }).expect(200);
    await b.post('/v1/auth/staff/mfa').send({ code: rc }).expect(204);
    const c2 = await browser(h.app);
    await c2.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD }).expect(200);
    await c2.post('/v1/auth/staff/mfa').send({ code: rc }).expect(401);
  });

  it('locks the account after 5 failed passwords and audits failures', async () => {
    const outlet = await makeOutlet(h.prisma);
    const staff = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const agent = await browser(h.app);
    for (let i = 0; i < 5; i++) await agent.post('/v1/auth/staff/login').send({ login: staff.email, password: 'wrong-password!' }).expect(401);
    const locked = await agent.post('/v1/auth/staff/login').send({ login: staff.email, password: PASSWORD }).expect(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(await h.prisma.auditLog.count({ where: { action: 'auth.staff_login_failed' } })).toBe(5);
    h.clock.advance(15 * 60_000 + 1);
    await agent.post('/v1/auth/staff/login').send({ login: staff.email, password: PASSWORD }).expect(200);
  });

  it('lets staff log in with a phone number typed in local or Bangla-digit form', async () => {
    const outlet = await makeOutlet(h.prisma);
    const rider = await makeStaff(h.prisma, 'DELIVERY_STAFF', outlet.id);
    await h.prisma.user.update({ where: { id: rider.user.id }, data: { phone: '+8801711000222' } });
    for (const login of ['01711000222', '০১৭১১০০০২২২', '+8801711000222']) {
      const agent = await browser(h.app);
      await agent.post('/v1/auth/staff/login').send({ login, password: PASSWORD }).expect(200);
    }
  });

  it('gives the same error for unknown accounts and wrong passwords', async () => {
    const agent = await browser(h.app);
    const r = await agent.post('/v1/auth/staff/login').send({ login: 'nobody@test.local', password: 'x' }).expect(401);
    expect(r.body.error.message).toBe('Invalid login or password');
  });

  it('expires idle staff sessions and honours logout', async () => {
    const outlet = await makeOutlet(h.prisma);
    const staff = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const agent = await loginStaff(h, staff);
    await agent.get(`/v1/admin/outlets/${outlet.id}`).expect(200);
    h.clock.advance(31 * 60_000);
    await agent.get(`/v1/admin/outlets/${outlet.id}`).expect(401);
    const again = await loginStaff(h, staff);
    await again.post('/v1/auth/logout').expect(204);
    await again.get(`/v1/admin/outlets/${outlet.id}`).expect(401);
  });

  it('cuts off a deactivated staff member immediately', async () => {
    const outlet = await makeOutlet(h.prisma);
    const sa = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
    const staff = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const s = await loginStaff(h, staff);
    const admin = await loginStaff(h, sa);
    const a = await h.prisma.outletStaff.findUniqueOrThrow({ where: { userId: staff.user.id } });
    await admin.post(`/v1/admin/outlets/${outlet.id}/staff/${a.id}/deactivate`).expect(200);
    await s.get(`/v1/admin/outlets/${outlet.id}`).expect(401);
  });
});

describe('health', () => {
  it('is ready when seeded', async () => {
    await request(h.app.getHttpServer()).get('/v1/health/ready').expect(200);
  });
});
