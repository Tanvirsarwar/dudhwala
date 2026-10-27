import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeOutlet, makeStaff, PASSWORD, startHarness, type Harness } from './support/harness.js';

/**
 * Boots the API with staging-shaped settings (https origins on one registrable domain, S3 media,
 * simulator allowed) and checks the cookie, CORS and CSRF behaviour the deployment guide relies on.
 */
const SHOP = 'https://shop.example.test';
const ADMIN = 'https://admin.example.test';
const STAGING_ENV = {
  NODE_ENV: 'staging',
  WEB_ORIGIN: SHOP,
  ADMIN_ORIGIN: ADMIN,
  API_PUBLIC_URL: 'https://api.example.test',
  MEDIA_STORAGE: 's3',
  STORAGE_ENDPOINT: 'https://storage.example.test/s3',
  STORAGE_BUCKET: 'bucket',
  STORAGE_ACCESS_KEY_ID: 'id',
  STORAGE_SECRET_ACCESS_KEY: 'secret',
  MEDIA_PUBLIC_URL: 'https://media.example.test',
  PAYMENTS_PROVIDER: 'fake',
  ALLOW_PAYMENT_SIMULATOR: 'true',
  PAYMENTS_WEBHOOK_SECRET: 'x'.repeat(40),
  SMS_PROVIDER: 'http',
  SMS_HTTP_URL: 'https://sms.example.test/send',
};

let h: Harness;
beforeAll(async () => (h = await startHarness({ env: STAGING_ENV })));
afterAll(async () => h.close());

/**
 * The test server speaks plain http, so a cookie jar correctly refuses to send back Secure cookies.
 * This helper plays the browser's part: it keeps the cookies from earlier responses and replays them by hand.
 */
async function secureBrowser(origin: string) {
  const jar = new Map<string, string>();
  const keep = (res: request.Response) => {
    for (const c of (res.headers['set-cookie'] ?? []) as unknown as string[]) {
      const [pair] = c.split(';');
      const i = pair!.indexOf('=');
      jar.set(pair!.slice(0, i), pair!.slice(i + 1));
    }
  };
  const csrfRes = await request(h.app.getHttpServer()).get('/v1/auth/csrf').set('origin', origin).expect(200);
  keep(csrfRes);
  const token = (csrfRes.body as { csrfToken: string }).csrfToken;
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  return {
    token,
    async post(path: string, body: object, extra: Record<string, string> = {}) {
      const res = await request(h.app.getHttpServer())
        .post(path)
        .set({ origin, cookie: cookie(), 'x-csrf-token': token, ...extra })
        .send(body);
      keep(res);
      return res;
    },
  };
}

const cookies = (res: request.Response, name: string) => ((res.headers['set-cookie'] ?? []) as unknown as string[]).find((c) => c.startsWith(`${name}=`)) ?? '';

describe('staging cookies, CORS and CSRF (single registrable domain)', () => {
  it('CSRF cookie is Secure, SameSite=Strict, host-only (no Domain attribute)', async () => {
    const res = await request(h.app.getHttpServer()).get('/v1/auth/csrf').set('origin', SHOP).expect(200);
    const c = cookies(res, 'dw_csrf');
    expect(c).toMatch(/; Secure/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).not.toMatch(/Domain=/i);
    expect(c).not.toMatch(/HttpOnly/i); // the script must be able to read it back; the token is also returned in the body
  });

  it('staff session cookie is HttpOnly, Secure, SameSite=Strict, host-only', async () => {
    const outlet = await makeOutlet(h.prisma);
    const staff = await makeStaff(h.prisma, 'OUTLET_STAFF', outlet.id);
    const agent = await secureBrowser(ADMIN);
    const res = await agent.post('/v1/auth/staff/login', { login: staff.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const c = cookies(res, 'dw_admin_sid');
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/; Secure/);
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).not.toMatch(/Domain=/i);
  });

  it('customer session cookie is HttpOnly, Secure, SameSite=Lax, host-only', async () => {
    const agent = await secureBrowser(SHOP);
    const aud = { 'x-dw-audience': 'customer' };
    const r = await agent.post('/v1/auth/otp/request', { phone: '01712345679' }, aud);
    expect(r.status).toBe(200);
    const v = await agent.post('/v1/auth/otp/verify', { challengeId: r.body.challengeId, code: h.sms.lastCode() }, aud);
    expect(v.status).toBe(200);
    const c = cookies(v, 'dw_sid');
    expect(c).toMatch(/HttpOnly/);
    expect(c).toMatch(/; Secure/);
    expect(c).toMatch(/SameSite=Lax/);
    expect(c).not.toMatch(/Domain=/i);
  });

  it('CORS allows exactly the configured storefront and admin origins, with credentials', async () => {
    const pre = (origin: string) => request(h.app.getHttpServer()).options('/v1/auth/csrf').set('origin', origin).set('access-control-request-method', 'POST');
    for (const ok of [SHOP, ADMIN]) {
      const res = await pre(ok);
      expect(res.headers['access-control-allow-origin']).toBe(ok);
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    }
    for (const bad of ['https://evil.example.test', 'https://www.example.test', `${SHOP}/`, 'http://shop.example.test']) {
      expect((await pre(bad)).headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('state-changing requests need an allowed Origin and a matching CSRF cookie + header', async () => {
    const agent = await secureBrowser(SHOP);
    const body = { phone: '01712345680' };
    expect((await agent.post('/v1/auth/otp/request', body, { origin: 'https://evil.example.test' })).status).toBe(403);
    expect((await agent.post('/v1/auth/otp/request', body, { 'x-csrf-token': 'forged.token' })).status).toBe(403);
    const noCookie = await request(h.app.getHttpServer()).post('/v1/auth/otp/request').set({ origin: SHOP, 'x-csrf-token': agent.token }).send(body);
    expect(noCookie.status).toBe(403); // header alone is not enough: double-submit needs the cookie too
    expect((await agent.post('/v1/auth/otp/request', body)).status).toBe(200);
  });
});
