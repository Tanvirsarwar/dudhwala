import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_RAW_ENV } from './support/harness.js';

/** The Vercel entry (src/serverless.ts) served by a plain Node http server: no Nest listen(), no fixed port. */
const ENV_KEYS = Object.keys(TEST_RAW_ENV);
const saved: Record<string, string | undefined> = {};
let server: Server;
type Handler = (req: never, res: never) => Promise<void>;

async function load(): Promise<Handler> {
  vi.resetModules();
  return (await import('../src/serverless.js')).default as unknown as Handler;
}
const serve = (h: Handler) => createServer((req, res) => void h(req as never, res as never));

beforeAll(() => {
  for (const k of [...ENV_KEYS, 'DATABASE_POOL_MAX', 'HEALTH_DIAG_TOKEN']) saved[k] = process.env[k];
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) Reflect.deleteProperty(process.env, k);
    else process.env[k] = v;
  }
  server?.close();
});

describe('serverless entry', () => {
  it('answers 503 JSON (no secrets) when configuration is missing, then recovers on the next request once it is fixed', async () => {
    for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k);
    const h = await load();
    const s = serve(h);
    const bad = await request(s).get('/v1/health/live');
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(bad.body)).not.toMatch(/SESSION_SECRET|DATABASE_URL/);
    Object.assign(process.env, TEST_RAW_ENV, { DATABASE_POOL_MAX: '1', HEALTH_DIAG_TOKEN: 'diag-token-0123456789abcdef0123' });
    const ok = await request(s).get('/v1/health/live');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ status: 'ok' });
  });

  it('serves real requests on one connection per instance: ready, catalogue, config, CSRF cookie, 404', async () => {
    Object.assign(process.env, TEST_RAW_ENV, { DATABASE_POOL_MAX: '1', HEALTH_DIAG_TOKEN: 'diag-token-0123456789abcdef0123' });
    const h = await load();
    server = serve(h);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await request(base).get('/v1/health/ready')).body).toEqual({ status: 'ok' });
    expect((await request(base).get('/v1/catalog/products')).status).toBe(200);
    expect((await request(base).get('/v1/config')).body.paymentMethods).toEqual(['COD']);
    const csrf = await request(base).get('/v1/auth/csrf');
    expect(csrf.status).toBe(200);
    expect(String(csrf.headers['set-cookie'])).toMatch(/dw_csrf=/);
    expect((await request(base).get('/v1/nope')).status).toBe(404);
    expect((await request(base).post('/v1/auth/staff/login').send({ login: 'a@b.co', password: 'x' })).status).toBe(403); // CSRF still enforced
  });

  it('reuses the one Nest app across requests (initialised once per warm instance)', async () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const a = await request(base).get('/v1/health/live');
    const b = await request(base).get('/v1/health/live');
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    expect(a.status + b.status).toBe(400);
  });

  it('runtime diagnostics: 404 without a configured token, 401 with a wrong one, pass/fail only with the right one', async () => {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect((await request(base).get('/v1/health/runtime')).status).toBe(401);
    expect((await request(base).get('/v1/health/runtime').set('authorization', 'Bearer wrong')).status).toBe(401);
    const ok = await request(base).get('/v1/health/runtime').set('authorization', 'Bearer diag-token-0123456789abcdef0123');
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ poolMax: 1, argon2: { ok: true, detail: true }, sharp: { ok: true, detail: true }, database: { ok: true, detail: { transaction: true, sessionTimeZone: 'UTC' } } });
    expect(JSON.stringify(ok.body)).not.toMatch(/postgres|secret/i);
    Reflect.deleteProperty(process.env, 'HEALTH_DIAG_TOKEN');
    const off = await load();
    const s2 = serve(off);
    expect((await request(s2).get('/v1/health/runtime').set('authorization', 'Bearer diag-token-0123456789abcdef0123')).status).toBe(404);
  });
});
