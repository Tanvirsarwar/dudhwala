import { readFileSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applySetup } from '../src/cli/setup.js';
import { createStaff } from '../src/cli/create-staff.js';
import { resetMfa } from '../src/cli/reset-mfa.js';
import { importCatalogue } from '../src/cli/import-catalogue.js';
import { loadEnv } from '../src/config/env.js';
import { adminAgent, managerAgent, PASSWORD, resetDb, startHarness, TEST_RAW_ENV, browser, type Harness } from './support/harness.js';
import { customer, home, makeProduct, makeShop, postOrder, type Shop } from './support/shop.js';

let h: Harness;
let shop: Shop;
beforeAll(async () => (h = await startHarness()));
afterAll(async () => h.close());
beforeEach(async () => {
  await resetDb(h.prisma);
  h.clock.t = new Date('2026-11-01T06:00:00Z');
  shop = await makeShop(h);
});

const CATALOGUE = JSON.parse(readFileSync(new URL('../../../demo/mock-api/catalogue.json', import.meta.url), 'utf8')) as { products: { id: string; nameVerified: boolean; outerCity: string | null }[]; categories: unknown[] };

describe('config (hours and bulk thresholds)', () => {
  it('serves defaults marked as placeholders, publicly', async () => {
    const res = await request(h.app.getHttpServer()).get('/v1/config').expect(200);
    expect(res.body).toEqual({ hours: { openMinute: 600, closeMinute: 1320 }, bulk: { minTotalQuantity: 20, minTotalPoisha: 2_000_000, isPlaceholder: true }, deliveryFees: { IN_CITY: 0, OUTER_CITY: 0 }, paymentMethods: ['COD'] });
  });
  it('an admin saves real values: placeholder flag clears, change is audited, orders obey it', async () => {
    const admin = await adminAgent(h);
    const put = await admin.put('/v1/admin/config').send({ hours: { open: '09:00', close: '23:00' }, bulk: { minTotalQuantity: 30, minTotalTaka: 5000 } }).expect(200);
    expect(put.body).toEqual({ hours: { openMinute: 540, closeMinute: 1380 }, bulk: { minTotalQuantity: 30, minTotalPoisha: 500_000, isPlaceholder: false }, deliveryFees: { IN_CITY: 0, OUTER_CITY: 0 }, paymentMethods: ['COD'] });
    expect((await request(h.app.getHttpServer()).get('/v1/config').expect(200)).body.bulk.isPlaceholder).toBe(false);
    const log = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'config.update' } });
    expect(log.before).toMatchObject({ bulk: { isPlaceholder: true } });
    h.clock.t = new Date('2026-11-01T03:30:00Z'); // 09:30 Dhaka: open under the new hours
    const { variant } = await makeProduct(h, { stock: 5, outletId: shop.outlet.id });
    const c = await customer(h);
    expect((await postOrder(c, home([{ variantId: variant.id, quantity: 1 }]))).status).toBe(201);
  });
  it('rejects bad values', async () => {
    const admin = await adminAgent(h);
    const bad = (b: object) => admin.put('/v1/admin/config').send(b);
    const ok = { hours: { open: '10:00', close: '22:00' }, bulk: { minTotalQuantity: 20, minTotalTaka: 20000 } };
    expect((await bad({ ...ok, hours: { open: '22:00', close: '10:00' } })).status).toBe(400);
    expect((await bad({ ...ok, hours: { open: 'abc', close: '10:00' } })).status).toBe(400);
    expect((await bad({ ...ok, bulk: { minTotalQuantity: 0, minTotalTaka: 5 } })).status).toBe(400);
    expect((await bad({ ...ok, bulk: { minTotalQuantity: 2.5, minTotalTaka: 5 } })).status).toBe(400);
    expect((await bad({ ...ok, extra: 1 })).status).toBe(400);
  });
});

describe('outlets', () => {
  it('lists active outlets publicly with hours; admin sets hours and roles', async () => {
    const admin = await adminAgent(h);
    await admin.put(`/v1/admin/outlets/${shop.outlet.id}/hours`).send({ hours: [{ weekday: 0, opens: '10:00', closes: '20:00' }] }).expect(200);
    const list = (await request(h.app.getHttpServer()).get('/v1/outlets').expect(200)).body;
    expect(list[0].hours).toEqual([{ weekday: 0, opens: '10:00', closes: '20:00' }]);
    expect(JSON.stringify(list)).not.toMatch(/dispatch|collection/);
    await admin.patch(`/v1/admin/outlets/${shop.outlet.id}`).send({ status: 'PAUSED' }).expect(200);
    expect((await request(h.app.getHttpServer()).get('/v1/outlets').expect(200)).body).toEqual([]);
    expect((await admin.put(`/v1/admin/outlets/${shop.outlet.id}/hours`).send({ hours: [{ weekday: 0, opens: '20:00', closes: '10:00' }] })).status).toBe(400);
    expect((await admin.put(`/v1/admin/outlets/${shop.outlet.id}/hours`).send({ hours: [{ weekday: 9, opens: '10:00', closes: '20:00' }] })).status).toBe(400);
    const roles = await admin.put('/v1/admin/fulfilment-outlets').send({ dispatchOutletId: shop.outlet.id, collectionOutletId: shop.outlet.id }).expect(200);
    expect(roles.body.dispatchOutletId).toBe(shop.outlet.id);
  });
});

describe('cart', () => {
  it('works anonymously, re-prices from the catalogue, caps by stock, and merges on login', async () => {
    const { variant } = await makeProduct(h, { priceTaka: 50, stock: 3, outletId: shop.outlet.id });
    const anon = request.agent(h.app.getHttpServer());
    anon.set('x-dw-audience', 'customer');
    const csrf = await anon.get('/v1/auth/csrf').expect(200);
    anon.set('x-csrf-token', csrf.body.csrfToken).set('origin', 'http://localhost:3000');
    const put = await anon.put(`/v1/cart/items/${variant.id}`).send({ quantity: 2 }).expect(200);
    expect(put.body).toMatchObject({ itemCount: 2, subtotalPoisha: 10_000 });
    expect((await anon.put(`/v1/cart/items/${variant.id}`).send({ quantity: 4 })).status).toBe(409); // only 3 in stock
    await h.prisma.productVariant.update({ where: { id: variant.id }, data: { pricePoisha: 6000 } });
    expect((await anon.get('/v1/cart').expect(200)).body.subtotalPoisha).toBe(12_000);
    const r = await anon.post('/v1/auth/otp/request').send({ phone: '01712349999' }).expect(200);
    await anon.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
    expect((await anon.get('/v1/cart').expect(200)).body.itemCount).toBe(2);
  });
  it('refuses unpriced or hidden products and shows a warning when a product disappears', async () => {
    const unpriced = await makeProduct(h, { priceTaka: null, stock: 3, outletId: shop.outlet.id });
    const hidden = await makeProduct(h, { stock: 3, outletId: shop.outlet.id });
    const c = await customer(h);
    expect((await c.put(`/v1/cart/items/${unpriced.variant.id}`).send({ quantity: 1 })).body.error.code).toBe('PRICE_NOT_SET');
    await c.put(`/v1/cart/items/${hidden.variant.id}`).send({ quantity: 1 }).expect(200);
    await h.prisma.product.update({ where: { id: hidden.product.id }, data: { active: false } });
    const cart = (await c.get('/v1/cart').expect(200)).body;
    expect(cart.warnings[0].code).toBe('UNAVAILABLE');
    expect(cart.lines[0].available).toBe(false);
    expect((await c.put(`/v1/cart/items/${hidden.variant.id}`).send({ quantity: 1 })).status).toBe(404);
  });
  it('a successful order empties the cart', async () => {
    const { variant } = await makeProduct(h, { stock: 3, outletId: shop.outlet.id });
    const c = await customer(h);
    await c.put(`/v1/cart/items/${variant.id}`).send({ quantity: 1 }).expect(200);
    await postOrder(c, home([{ variantId: variant.id, quantity: 1 }])).expect(201);
    expect((await c.get('/v1/cart').expect(200)).body.itemCount).toBe(0);
  });
});

describe('audit log', () => {
  it('records admin writes and order events, is readable by staff, and cannot be edited or deleted', async () => {
    const admin = await adminAgent(h);
    await admin.post('/v1/admin/categories').send({ nameBn: 'ক', nameEn: 'a' }).expect(201);
    const { variant } = await makeProduct(h, { stock: 3, outletId: shop.outlet.id });
    const c = await customer(h);
    await postOrder(c, home([{ variantId: variant.id, quantity: 1 }])).expect(201);
    const log = (await admin.get('/v1/admin/audit').expect(200)).body.data as { action: string; actorRole: string }[];
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['category.create', 'order.place', 'auth.staff_login']));
    expect(log.find((l) => l.action === 'category.create')!.actorRole).toBe('ADMIN');
    await expect(h.prisma.auditLog.deleteMany()).rejects.toThrow();
    await expect(h.prisma.auditLog.updateMany({ data: { action: 'x' } })).rejects.toThrow();
    expect((await (await managerAgent(h)).get('/v1/admin/audit')).status).toBe(200);
  });
  it('never stores passwords, codes or tokens', async () => {
    await adminAgent(h);
    await customer(h);
    const all = JSON.stringify(await h.prisma.auditLog.findMany());
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toMatch(/password|secret|token/i);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and no-store, and hides the framework', async () => {
    const res = await request(h.app.getHttpServer()).get('/v1/health/live').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });
  it('errors are uniform and leak no internals', async () => {
    const a = await browser(h.app);
    const bad = await a.post('/v1/auth/staff/login').set('content-type', 'application/json').send('{"login": ');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at |node_modules|stack|SyntaxError/);
    const nf = await request(h.app.getHttpServer()).get('/v1/nope').expect(404);
    expect(nf.body.error.code).toBe('NOT_FOUND');
    expect((await request(h.app.getHttpServer()).get('/v1/catalog/products?page=abc')).status).toBe(400);
  });
  it('every route declares an access rule (fail closed): an undeclared route would be 403', async () => {
    // Guard-level check: the router has no handler without a rule, proven by the metadata scan below.
    const { ACCESS_KEY } = await import('../src/access/decorators.js');
    const mods = await Promise.all([
      import('../src/auth/auth.controller.js'), import('../src/catalog/catalog-admin.controller.js'), import('../src/catalog/catalog-public.controller.js'),
      import('../src/cart/cart.controller.js'), import('../src/orders/orders.controller.js'), import('../src/orders/orders-admin.controller.js'),
      import('../src/outlets/outlets.controller.js'), import('../src/settings/config.controller.js'), import('../src/health/health.controller.js'),
    ]);
    let handlers = 0;
    for (const m of mods) {
      for (const C of Object.values(m) as (new (...a: never[]) => unknown)[]) {
        if (typeof C !== 'function' || !C.prototype) continue;
        for (const name of Object.getOwnPropertyNames(C.prototype)) {
          if (name === 'constructor' || Reflect.getMetadata('path', C.prototype[name]) === undefined) continue;
          handlers++;
          const rule = Reflect.getMetadata(ACCESS_KEY, C.prototype[name]) ?? Reflect.getMetadata(ACCESS_KEY, C);
          expect(rule, `${C.name}.${name}`).toBeDefined();
        }
      }
    }
    expect(handlers).toBeGreaterThan(40);
  });
  it('health: live always, ready only with a working database', async () => {
    await request(h.app.getHttpServer()).get('/v1/health/live').expect(200);
    expect((await request(h.app.getHttpServer()).get('/v1/health/ready').expect(200)).body).toEqual({ status: 'ok' });
  });
});

describe('environment guards', () => {
  const base = { ...TEST_RAW_ENV, NODE_ENV: 'production', API_PUBLIC_URL: 'https://api.example.test', MEDIA_STORAGE: 's3', STORAGE_BUCKET: 'b', STORAGE_ACCESS_KEY_ID: 'i', STORAGE_SECRET_ACCESS_KEY: 's', MEDIA_PUBLIC_URL: 'https://m.example.test', SMS_PROVIDER: 'http', SMS_HTTP_URL: 'https://sms.example.test/x', WEB_ORIGIN: 'https://shop.example.test', ADMIN_ORIGIN: 'https://admin.example.test' };
  it('accepts a sane production configuration (needs no payment-gateway settings)', () => {
    expect(loadEnv(base).NODE_ENV).toBe('production');
    expect(Object.keys(loadEnv(base)).some((k) => /PAYMENT|SSLCOMMERZ|STRIPE/i.test(k))).toBe(false);
  });
  it('refuses plain-http API, local media, log SMS and the dev outbox in production', () => {
    expect(() => loadEnv({ ...base, API_PUBLIC_URL: 'http://api.example.test' })).toThrow(/API_PUBLIC_URL/);
    expect(() => loadEnv({ ...base, MEDIA_STORAGE: 'local' })).toThrow(/MEDIA_STORAGE/);
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'log' })).toThrow(/SMS_PROVIDER/);
    expect(() => loadEnv({ ...base, ENABLE_DEV_OUTBOX: 'true' })).toThrow(/ENABLE_DEV_OUTBOX/);
  });
  it('error messages name variables, never values', () => {
    try {
      loadEnv({ ...base, SESSION_SECRET: 'short-secret-value' });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain('SESSION_SECRET');
      expect(String(e)).not.toContain('short-secret-value');
    }
  });
});

describe('setup and import commands', () => {
  it('imports the real catalogue idempotently, hidden and unpriced, and keeps admin edits on re-run', async () => {
    const first = await importCatalogue(h.prisma, CATALOGUE);
    expect(first).toEqual({ categoriesCreated: 3, productsCreated: CATALOGUE.products.length, productsSkipped: 0 });
    expect(CATALOGUE.products.length).toBe(59);
    expect(await h.prisma.product.count({ where: { active: true } })).toBe(0);
    const variants = await h.prisma.productVariant.findMany();
    expect(variants).toHaveLength(59);
    expect(variants.every((v) => v.pricePoisha === null)).toBe(true);
    expect(await h.prisma.product.count({ where: { nameVerified: false } })).toBe(CATALOGUE.products.filter((p) => !p.nameVerified).length);
    expect(await h.prisma.product.count({ where: { outerCityStatus: 'APPROVED' } })).toBe(CATALOGUE.products.filter((p) => p.outerCity === 'approved').length);
    await h.prisma.product.update({ where: { slug: 'ds-24' }, data: { nameBn: 'এডমিন সম্পাদিত', active: true } });
    const second = await importCatalogue(h.prisma, CATALOGUE);
    expect(second).toEqual({ categoriesCreated: 0, productsCreated: 0, productsSkipped: 59 });
    expect(await h.prisma.product.findUniqueOrThrow({ where: { slug: 'ds-24' } })).toMatchObject({ nameBn: 'এডমিন সম্পাদিত', active: true });
    expect(await h.prisma.productVariant.count()).toBe(59);
  });
  it('--activate publishes new products, but unpriced ones still cannot be ordered', async () => {
    await importCatalogue(h.prisma, CATALOGUE, { activate: true });
    expect(await h.prisma.product.count({ where: { active: true } })).toBe(59);
    await h.prisma.setting.createMany({ data: [{ key: 'fulfilment.dispatchOutletId', value: shop.outlet.id }], skipDuplicates: true });
    const v = await h.prisma.productVariant.findFirstOrThrow();
    const c = await customer(h);
    expect((await postOrder(c, home([{ variantId: v.id, quantity: 1 }]))).body.error.code).toBe('PRICE_NOT_SET');
  });
  it('rejects a catalogue that points to an unknown category', async () => {
    await expect(importCatalogue(h.prisma, { categories: [{ slug: 'a', nameBn: 'ক', nameEn: 'a' }], products: [{ id: 'p1', category: 'zzz', nameBn: 'ক', nameEn: 'a', nameVerified: true }] })).rejects.toThrow(/unknown category/);
    expect(await h.prisma.product.count()).toBe(0);
  });
  it('setup creates outlets (Modina Market Branch as the bulk collection outlet) and resolves their ids', async () => {
    await resetDb(h.prisma);
    const file = { outlets: [{ code: 'MODINA-MARKET', nameBn: 'মদিনা মার্কেট শাখা', nameEn: 'Modina Market Branch', addressLine: 'x', hours: [{ weekday: 0, opens: '10:00', closes: '22:00' }] }, { code: 'OTHER', nameBn: 'অন্য', addressLine: 'y' }], dispatchOutletCode: 'OTHER', collectionOutletCode: 'MODINA-MARKET' };
    expect(await applySetup(h.prisma, file)).toMatchObject({ outlets: 2, collection: 'MODINA-MARKET' });
    const modina = await h.prisma.outlet.findUniqueOrThrow({ where: { code: 'MODINA-MARKET' } });
    expect((await h.prisma.setting.findUniqueOrThrow({ where: { key: 'bulk.collectionOutletId' } })).value).toBe(modina.id);
    expect((await h.prisma.setting.findUniqueOrThrow({ where: { key: 'fulfilment.dispatchOutletId' } })).value).toBe((await h.prisma.outlet.findUniqueOrThrow({ where: { code: 'OTHER' } })).id);
    await applySetup(h.prisma, file); // re-run: no duplicates
    expect(await h.prisma.outlet.count()).toBe(2);
    await expect(applySetup(h.prisma, { ...file, collectionOutletCode: 'NOPE' })).rejects.toThrow(/Unknown outlet code/);
    await expect(applySetup(h.prisma, { outlets: [] })).rejects.toThrow();
  });
  it('create-staff makes an admin or manager, refuses duplicates and weak passwords; reset-mfa clears 2FA and sessions', async () => {
    const id = await createStaff(h.prisma, { role: 'MANAGER', email: 'Boss@Example.com', name: 'Boss', password: 'a-long-enough-password' });
    expect(await h.prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ email: 'boss@example.com', staffRole: 'MANAGER', kind: 'STAFF' });
    await expect(createStaff(h.prisma, { role: 'ADMIN', email: 'boss@example.com', name: 'x', password: 'a-long-enough-password' })).rejects.toThrow(/already exists/);
    await expect(createStaff(h.prisma, { role: 'ADMIN', email: 'new@example.com', name: 'x', password: 'short' })).rejects.toThrow(/at least 12/);
    await expect(createStaff(h.prisma, { role: 'ADMIN', email: 'not-an-email', name: 'x', password: 'a-long-enough-password' })).rejects.toThrow(/Invalid email/);
    const a = await adminAgent(h);
    const email = (await h.prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).email!;
    await resetMfa(h.prisma, email);
    expect(await h.prisma.user.findUniqueOrThrow({ where: { id: a.userId } })).toMatchObject({ mfaEnabled: false, mfaTotpSecretEnc: null });
    expect((await a.get('/v1/me')).status).toBe(401);
  });
});
