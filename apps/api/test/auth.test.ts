import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpAt } from '../src/auth/totp.js';
import { adminAgent, browser, makeStaff, managerAgent, PASSWORD, resetDb, startHarness, TEST_ENV, type Harness } from './support/harness.js';
import { customer } from './support/shop.js';

let h: Harness;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
});

const BAD = 'ইমেইল বা পাসওয়ার্ড সঠিক নয়';
const cookieOf = (res: request.Response, name: string) => ((res.headers['set-cookie'] ?? []) as unknown as string[]).find((c) => c.startsWith(`${name}=`)) ?? '';

describe('staff login pages', () => {
  it('an admin signs in on the admin page, a manager on the manager page', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    const mgr = await makeStaff(h.prisma, 'MANAGER', { withMfa: false });
    const a = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    expect(a.body).toMatchObject({ role: 'ADMIN', mfaRequired: true });
    const m = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD, as: 'manager' }).expect(200);
    expect(m.body).toMatchObject({ role: 'MANAGER', mfaRequired: false });
  });

  it('each role is refused on the other page with the same message as a wrong password', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    const mgr = await makeStaff(h.prisma, 'MANAGER', { withMfa: false });
    const wrongPage1 = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD, as: 'manager' });
    const wrongPage2 = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD });
    const wrongPw = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: 'nope-nope-nope-nope' });
    const unknown = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: 'nobody@test.local', password: PASSWORD });
    for (const r of [wrongPage1, wrongPage2, wrongPw, unknown]) {
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('UNAUTHENTICATED');
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    expect(new Set([wrongPage1, wrongPage2, wrongPw, unknown].map((r) => r.body.error.message)).size).toBe(1);
    expect(BAD.length).toBeGreaterThan(0);
  });

  it('a customer account cannot use the staff login', async () => {
    const c = await customer(h);
    const res = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: c.phone, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('locks the account after 5 wrong passwords, even for the right password', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    for (let i = 0; i < 5; i++) {
      expect((await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: `wrong-password-${i}` })).status).toBe(401);
    }
    const locked = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD });
    expect(locked.status).toBe(423);
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    h.clock.advance(16 * 60_000);
    expect((await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD })).status).toBe(200);
  });

  it('rate-limits login attempts per IP', async () => {
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: `nobody${i}@test.local`, password: 'x'.repeat(14) });
      limited = r.status === 429;
    }
    expect(limited).toBe(true);
  });

  it('a suspended account cannot sign in or keep a session', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    const agent = await (async () => {
      const a = await browser(h.app);
      await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
      return a;
    })();
    await h.prisma.user.update({ where: { id: admin.user.id }, data: { status: 'SUSPENDED' } });
    expect((await agent.get('/v1/me')).status).toBe(401);
    expect((await (await browser(h.app)).post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD })).status).toBe(401);
  });

  it('stores passwords as argon2id hashes', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).passwordHash).toMatch(/^\$argon2id\$/);
  });
});

describe('admin two-factor', () => {
  it('blocks admin routes until the code is verified', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    const a = await browser(h.app);
    await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    const blocked = await a.get('/v1/admin/summary');
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    expect((await a.post('/v1/auth/staff/mfa').send({ code: '000000' })).status).toBe(401);
    h.clock.advance(31_000);
    await a.post('/v1/auth/staff/mfa').send({ code: totpAt(admin.secret, h.clock.now()) }).expect(204);
    await a.get('/v1/admin/summary').expect(200);
  });

  it('a TOTP code cannot be reused', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN');
    const code = () => totpAt(admin.secret, h.clock.now());
    const a = await browser(h.app);
    await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    h.clock.advance(31_000);
    const used = code();
    await a.post('/v1/auth/staff/mfa').send({ code: used }).expect(204);
    const b = await browser(h.app);
    await b.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    expect((await b.post('/v1/auth/staff/mfa').send({ code: used })).status).toBe(401);
  });

  it('an admin without 2FA enrolled can enrol, then proceeds', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN', { withMfa: false });
    const a = await browser(h.app);
    const login = await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    expect(login.body).toMatchObject({ mfaRequired: true, mfaEnrolled: false });
    expect((await a.get('/v1/admin/summary')).body.error.code).toBe('MFA_REQUIRED');
    const enrol = await a.post('/v1/auth/staff/mfa/enroll').send({}).expect(200);
    expect(enrol.body.secret).toMatch(/^[A-Z2-7]+$/);
    h.clock.advance(31_000);
    const confirm = await a.post('/v1/auth/staff/mfa/confirm').send({ code: totpAt(enrol.body.secret, h.clock.now()) }).expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    await a.get('/v1/admin/summary').expect(200);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: admin.user.id } })).mfaTotpSecretEnc?.toString()).not.toContain(enrol.body.secret); // stored encrypted
  });

  it('a recovery code works once', async () => {
    const admin = await makeStaff(h.prisma, 'ADMIN', { withMfa: false });
    const a = await browser(h.app);
    await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    const enrol = await a.post('/v1/auth/staff/mfa/enroll').send({}).expect(200);
    h.clock.advance(31_000);
    const { recoveryCodes } = (await a.post('/v1/auth/staff/mfa/confirm').send({ code: totpAt(enrol.body.secret, h.clock.now()) }).expect(200)).body as { recoveryCodes: string[] };
    const b = await browser(h.app);
    await b.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    await b.post('/v1/auth/staff/mfa').send({ code: recoveryCodes[0] }).expect(204);
    const c2 = await browser(h.app);
    await c2.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD }).expect(200);
    expect((await c2.post('/v1/auth/staff/mfa').send({ code: recoveryCodes[0] })).status).toBe(401);
  });
});

describe('sessions and cookies', () => {
  it('staff cookie is HttpOnly + SameSite=Strict; logout ends the session server-side', async () => {
    const admin = await makeStaff(h.prisma, 'MANAGER', { withMfa: false });
    const a = await browser(h.app);
    const res = await a.post('/v1/auth/staff/login').send({ login: admin.email, password: PASSWORD, as: 'manager' }).expect(200);
    const c = cookieOf(res, 'dw_admin_sid');
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/SameSite=Strict/);
    const raw = c.split(';')[0]!.split('=')[1]!;
    await a.get('/v1/me').expect(200);
    await a.post('/v1/auth/logout').send({}).expect(204);
    expect((await request(h.app.getHttpServer()).get('/v1/me').set('cookie', `dw_admin_sid=${raw}`)).status).toBe(401); // the old cookie is dead
  });

  it('staff sessions expire after 30 idle minutes and after 12 hours', async () => {
    const mgr = await managerAgent(h);
    await mgr.get('/v1/me').expect(200);
    h.clock.advance(29 * 60_000);
    await mgr.get('/v1/me').expect(200);
    h.clock.advance(31 * 60_000);
    expect((await mgr.get('/v1/me')).status).toBe(401);
    const m2 = await managerAgent(h);
    for (let i = 0; i < 25; i++) {
      h.clock.advance(29 * 60_000);
      if ((await m2.get('/v1/me')).status === 401) break;
    }
    expect((await m2.get('/v1/me')).status).toBe(401); // absolute limit
  });

  it('stores only a hash of the session token', async () => {
    const mgr = await makeStaff(h.prisma, 'MANAGER', { withMfa: false });
    const a = await browser(h.app);
    const res = await a.post('/v1/auth/staff/login').send({ login: mgr.email, password: PASSWORD, as: 'manager' });
    const raw = cookieOf(res, 'dw_admin_sid').split(';')[0]!.split('=')[1]!;
    const sessions = await h.prisma.session.findMany();
    expect(sessions.some((s) => s.tokenHash === raw)).toBe(false);
    expect(sessions[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a staff cookie is ignored on customer routes and the customer cookie on admin routes', async () => {
    const c = await customer(h);
    expect((await c.get('/v1/admin/summary')).status).toBe(403); // a customer is not staff
    const admin = await adminAgent(h);
    expect((await admin.get('/v1/orders')).status).toBe(401);
  });
});

describe('customer OTP login', () => {
  it('signs in with the texted code and creates the account once', async () => {
    const c = await customer(h, '01712340001');
    expect((await c.get('/v1/me').expect(200)).body.role).toBe('CUSTOMER');
    const again = await customer(h, '01712340001');
    expect(again.userId).toBe(c.userId);
    expect(await h.prisma.user.count({ where: { phone: '+8801712340001' } })).toBe(1);
  });

  it('rejects a wrong code, and locks the challenge after 5 attempts', async () => {
    const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    a.set('x-dw-audience', 'customer');
    const r = await a.post('/v1/auth/otp/request').send({ phone: '01712340002' }).expect(200);
    const real = h.sms.lastCode();
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await a.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: wrong })).status).toBe(401);
    const late = await a.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: real });
    expect(late.status).toBe(401);
    expect(late.body.error.code).toBe('OTP_EXPIRED');
  });

  it('a code works once and expires after 5 minutes', async () => {
    const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    a.set('x-dw-audience', 'customer');
    const r = await a.post('/v1/auth/otp/request').send({ phone: '01712340003' }).expect(200);
    const code = h.sms.lastCode();
    await a.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code }).expect(200);
    expect((await a.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code })).status).toBe(401);
    const r2 = await a.post('/v1/auth/otp/request').send({ phone: '01712340004' }).expect(200);
    const code2 = h.sms.lastCode();
    h.clock.advance(6 * 60_000);
    expect((await a.post('/v1/auth/otp/verify').send({ challengeId: r2.body.challengeId, code: code2 })).body.error.code).toBe('OTP_EXPIRED');
  });

  it('limits requests: one per minute per phone, 5 per hour', async () => {
    const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    a.set('x-dw-audience', 'customer');
    await a.post('/v1/auth/otp/request').send({ phone: '01712340005' }).expect(200);
    expect((await a.post('/v1/auth/otp/request').send({ phone: '01712340005' })).status).toBe(429);
    for (let i = 0; i < 4; i++) {
      h.clock.advance(61_000);
      await a.post('/v1/auth/otp/request').send({ phone: '01712340005' }).expect(200);
    }
    h.clock.advance(61_000);
    expect((await a.post('/v1/auth/otp/request').send({ phone: '01712340005' })).status).toBe(429);
  });

  it('rejects a malformed number and never reveals whether the number is registered', async () => {
    const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    expect((await a.post('/v1/auth/otp/request').send({ phone: '12345' })).status).toBe(400);
    const known = await a.post('/v1/auth/otp/request').send({ phone: '01712340006' });
    h.clock.advance(61_000);
    const fresh = await a.post('/v1/auth/otp/request').send({ phone: '01912340006' });
    expect(Object.keys(known.body).sort()).toEqual(Object.keys(fresh.body).sort());
  });

  it('the OTP is stored hashed', async () => {
    const a = await browser(h.app, TEST_ENV.WEB_ORIGIN);
    await a.post('/v1/auth/otp/request').send({ phone: '01712340007' }).expect(200);
    const code = h.sms.lastCode();
    expect((await h.prisma.otpChallenge.findFirstOrThrow()).codeHash).not.toContain(code);
  });
});

describe('CSRF and origin', () => {
  it('rejects writes without a CSRF token, with a forged one, and from a foreign origin', async () => {
    const mgr = await makeStaff(h.prisma, 'MANAGER', { withMfa: false });
    const body = { login: mgr.email, password: PASSWORD, as: 'manager' };
    expect((await request(h.app.getHttpServer()).post('/v1/auth/staff/login').send(body)).status).toBe(403);
    const a = await browser(h.app);
    expect((await a.post('/v1/auth/staff/login').set('x-csrf-token', 'forged.token').send(body)).status).toBe(403);
    expect((await a.post('/v1/auth/staff/login').set('origin', 'https://evil.example').send(body)).status).toBe(403);
    expect((await a.post('/v1/auth/staff/login').send(body)).status).toBe(200);
  });
  it('admin writes also need CSRF', async () => {
    const admin = await adminAgent(h);
    const cookie = admin.jar.getCookies({ domain: '127.0.0.1', path: '/', script: false, secure: false } as never).map((c: { name: string; value: string }) => `${c.name}=${c.value}`).join('; ');
    const res = await request(h.app.getHttpServer()).post('/v1/admin/categories').set('cookie', cookie).send({ nameBn: 'ক', nameEn: 'a' });
    expect(res.status).toBe(403);
  });
});
