// API tests for the demo server: roles, writes, validation, orders. Run: pnpm test:demo (needs the shared package built).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4300 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/v1`;
const tmp = mkdtempSync(join(tmpdir(), 'dw-mock-'));
let proc;

async function call(method, path, { body, cookie, csrf = true } = {}) {
  const res = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(csrf && method !== 'GET' ? { 'x-csrf-token': 't' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null, setCookie: res.headers.get('set-cookie') };
}
async function login(as, login, password) {
  const r = await call('POST', '/auth/staff/login', { body: { as, login, password } });
  return { ...r, cookie: r.setCookie?.split(';')[0] };
}
let admin, manager, products, bakery;

before(async () => {
  proc = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname], { env: { ...process.env, MOCK_API_PORT: String(PORT), MOCK_RUNTIME_DIR: join(tmp, 'runtime'), MOCK_MEDIA_DIR: join(tmp, 'media') }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/health/ready')).ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 100)); }
  admin = await login('admin', 'admin@demo.local', 'demo1234');
  manager = await login('manager', 'manager@demo.local', 'manager1234');
  products = (await call('GET', '/admin/products', { cookie: admin.cookie })).json.data;
  bakery = products.find((p) => p.categorySlug === 'bakery');
});
after(() => { proc?.kill(); rmSync(tmp, { recursive: true, force: true }); });

test('each account only signs in on its own login page', async () => {
  assert.equal(admin.status, 200); assert.equal(manager.status, 200);
  assert.equal((await login('manager', 'admin@demo.local', 'demo1234')).status, 401);
  assert.equal((await login('admin', 'manager@demo.local', 'manager1234')).status, 401);
  assert.equal((await login('admin', 'admin@demo.local', 'nope')).status, 401);
  assert.match(admin.setCookie, /HttpOnly/); assert.match(admin.setCookie, /SameSite=Strict/);
});

test('staff area needs a session; /me reports the role', async () => {
  assert.equal((await call('GET', '/admin/summary')).status, 401);
  assert.equal((await call('GET', '/me')).status, 401);
  assert.deepEqual((await call('GET', '/me', { cookie: admin.cookie })).json.role, 'ADMIN');
  const m = (await call('GET', '/me', { cookie: manager.cookie })).json;
  assert.equal(m.role, 'MANAGER'); assert.equal(m.canEdit, false);
});

test('manager can read but every write is refused (403 READ_ONLY)', async () => {
  for (const path of ['/admin/summary', '/admin/orders', '/admin/products', '/admin/categories', '/admin/config']) assert.equal((await call('GET', path, { cookie: manager.cookie })).status, 200, path);
  for (const [m, path, body] of [['PATCH', `/admin/products/${bakery.id}`, { nameBn: 'x' }], ['POST', '/admin/products', {}], ['POST', '/admin/categories', {}], ['PUT', '/admin/config', {}], ['POST', '/admin/reset', {}], ['POST', `/admin/products/${bakery.id}/image`, { dataBase64: 'AA==' }], ['DELETE', `/admin/products/${bakery.id}/image`, undefined]]) {
    const r = await call(m, path, { cookie: manager.cookie, body });
    assert.equal(r.status, 403, `${m} ${path}`); assert.equal(r.json.error.code, 'READ_ONLY');
  }
});

test('admin writes need the CSRF header', async () => {
  assert.equal((await call('PATCH', `/admin/products/${bakery.id}`, { cookie: admin.cookie, body: { nameEn: 'X' }, csrf: false })).status, 403);
});

test('product edit: prices/stock/validation and storefront reflects it', async () => {
  const v = bakery.variants[0];
  const ok = await call('PATCH', `/admin/products/${bakery.id}`, { cookie: admin.cookie, body: { variants: [{ id: v.id, labelBn: '৫০০ গ্রাম', pricePoisha: 12000, compareAtPoisha: 15000, stock: 3, maxQty: 10 }, { labelBn: '১ কেজি', pricePoisha: 22000, compareAtPoisha: null, stock: 0, maxQty: 10 }], content: { descriptionBn: 'বিবরণ' } } });
  assert.equal(ok.status, 200);
  const d = (await call('GET', `/catalog/products/${bakery.slug}`)).json;
  assert.equal(d.variants.length, 2); assert.equal(d.variants[0].pricePoisha, 12000); assert.equal(d.variants[1].availability, 'OUT_OF_STOCK'); assert.equal(d.content.descriptionBn, 'বিবরণ');
  for (const bad of [{ variants: [{ id: v.id, pricePoisha: -5 }] }, { variants: [{ id: v.id, pricePoisha: 1.5 }] }, { variants: [{ id: v.id, pricePoisha: 100, compareAtPoisha: 50 }] }, { variants: [] }, { nameBn: '' }, { categorySlug: 'nope' }, { outerCityStatus: 'bogus' }, { variants: [{ id: v.id, pricePoisha: 1, maxQty: 0 }] }]) assert.equal((await call('PATCH', `/admin/products/${bakery.id}`, { cookie: admin.cookie, body: bad })).status, 400, JSON.stringify(bad));
  assert.equal((await call('GET', `/catalog/products/${bakery.slug}`)).json.variants[0].pricePoisha, 12000, 'rejected edits change nothing');
});

test('hidden products vanish from the storefront and the cart', async () => {
  const p = products.find((x) => x.categorySlug === 'dairy-sweets');
  await call('PATCH', `/admin/products/${p.id}`, { cookie: admin.cookie, body: { active: false } });
  assert.equal((await call('GET', `/catalog/products/${p.slug}`)).status, 404);
  assert.ok(!(await call('GET', '/catalog/products?limit=48')).json.data.some((x) => x.slug === p.slug));
  await call('PATCH', `/admin/products/${p.id}`, { cookie: admin.cookie, body: { active: true } });
});

test('image upload checks the file bytes, not the name or declared type', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const bad = await call('POST', `/admin/products/${bakery.id}/image`, { cookie: admin.cookie, body: { dataBase64: Buffer.from('<svg onload=alert(1)>').toString('base64') } });
  assert.equal(bad.status, 400);
  assert.equal((await call('POST', `/admin/products/${bakery.id}/image`, { cookie: admin.cookie, body: { dataBase64: Buffer.alloc(6 * 1024 * 1024, 1).toString('base64') } })).status, 413, 'over 5 MB (request cap)');
  assert.equal((await call('POST', `/admin/products/${bakery.id}/image`, { cookie: admin.cookie, body: { dataBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5.5 * 1024 * 1024 - 3, 1)]).toString('base64').slice(0, 7_700_000) } })).status, 413, 'oversize image is refused');
  const good = await call('POST', `/admin/products/${bakery.id}/image`, { cookie: admin.cookie, body: { dataBase64: png.toString('base64') } });
  assert.equal(good.status, 200); assert.match(good.json.image, /\/media\/photos\/.*\.png\?v=/);
  const img = await fetch(`http://127.0.0.1:${PORT}${good.json.image}`);
  assert.equal(img.headers.get('content-type'), 'image/png'); assert.equal(img.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await call('DELETE', `/admin/products/${bakery.id}/image`, { cookie: admin.cookie })).json.image, null);
});

test('settings: hours and bulk limits validated and served publicly', async () => {
  assert.equal((await call('PUT', '/admin/config', { cookie: admin.cookie, body: { hours: { open: '12:00', close: '11:00' }, bulk: { minTotalQuantity: 5, minTotalTaka: 100 } } })).status, 400);
  assert.equal((await call('PUT', '/admin/config', { cookie: admin.cookie, body: { hours: { open: '09:00', close: '21:30' }, bulk: { minTotalQuantity: 0, minTotalTaka: 100 } } })).status, 400);
  assert.equal((await call('PUT', '/admin/config', { cookie: admin.cookie, body: { hours: { open: '09:00', close: '21:30' }, bulk: { minTotalQuantity: 5, minTotalTaka: 1000 } } })).status, 200);
  const c = (await call('GET', '/config')).json;
  assert.deepEqual([c.hours.openMinute, c.hours.closeMinute, c.bulk.minTotalQuantity, c.bulk.minTotalPoisha, c.bulk.isPlaceholder], [540, 1290, 5, 100000, false]);
  await call('PUT', '/admin/config', { cookie: admin.cookie, body: { hours: { open: '10:00', close: '22:00' }, bulk: { minTotalQuantity: 20, minTotalTaka: 20000 } } });
});

const addr = { name: 'রহিম', phone: '01712345678', line1: 'জিন্দাবাজার', landmark: '' };
test('orders: server prices the lines, repeats zone + bulk rules, never leaks contact data', async () => {
  const sweet = products.find((x) => x.categorySlug === 'dairy-sweets' && !x.outerCityStatus);
  const sv = (await call('GET', `/admin/products/${sweet.id}`, { cookie: admin.cookie })).json.variants[0].id;
  const bv = (await call('GET', `/admin/products/${bakery.id}`, { cookie: admin.cookie })).json.variants;
  const home = (lines, zone) => call('POST', '/orders', { body: { method: 'HOME_DELIVERY', zone, lines, address: addr } });
  assert.equal((await home([{ variantId: sv, quantity: 1 }], 'OUTER_CITY')).json.error.code, 'NOT_DELIVERABLE', 'unflagged sweet cannot go Outer Sylhet');
  assert.equal((await home([{ variantId: sv, quantity: 1 }], null)).status, 422);
  assert.equal((await home([{ variantId: 'nope', quantity: 1 }], 'IN_CITY')).status, 409);
  assert.equal((await home([{ variantId: bv[0].id, quantity: 0 }], 'IN_CITY')).status, 400);
  assert.equal((await home([{ variantId: bv[0].id, quantity: 4 }], 'IN_CITY')).json.error.code, 'OUT_OF_STOCK', 'more than the stock of 3');
  const r = await home([{ variantId: bv[0].id, quantity: 2 }], 'OUTER_CITY');
  assert.equal(r.status, 201); assert.equal(r.json.totalPoisha, 24000, 'price comes from the server, not the client'); assert.equal(r.json.status, 'DEMO_PLACED'); assert.match(r.json.id, /^DEMO-\d+$/);
  assert.equal((await call('POST', '/orders', { body: { method: 'HOME_DELIVERY', zone: 'IN_CITY', lines: [{ variantId: sv, quantity: 1 }], address: { ...addr, phone: '123' } } })).status, 400);
  assert.equal((await call('POST', '/orders', { body: { method: 'BULK_ORDER', lines: [{ variantId: sv, quantity: 1 }], contact: addr, payment: 'DEMO_PAID_SIMULATED' } })).json.error.code, 'NOT_BULK');
  assert.equal((await call('POST', '/orders', { body: { method: 'BULK_ORDER', lines: [{ variantId: sv, quantity: 25 }], contact: addr } })).json.error.code, 'PREPAYMENT_REQUIRED');
  assert.equal((await call('POST', '/orders', { body: { method: 'HOME_DELIVERY', zone: 'IN_CITY', lines: [{ variantId: sv, quantity: 25 }], address: addr } })).json.error.code, 'BULK_REQUIRED');
  const b = await call('POST', '/orders', { body: { method: 'BULK_ORDER', lines: [{ variantId: sv, quantity: 25 }], contact: addr, payment: 'DEMO_PAID_SIMULATED' } });
  assert.equal(b.status, 201); assert.equal(b.json.outlet.nameEn, 'Modina Market Branch'); assert.equal(b.json.totalPoisha, null, 'no price yet -> total unknown, never invented');
  assert.equal(typeof r.json.token, 'string', 'the creator receives a private lookup token');
  assert.equal((await call('GET', `/orders/${r.json.id}`)).status, 404, 'no token -> not found');
  assert.equal((await fetch(`${BASE}/orders/${r.json.id}`, { headers: { 'x-order-token': 'wrong' } })).status, 404);
  const mine = await (await fetch(`${BASE}/orders/${r.json.id}`, { headers: { 'x-order-token': r.json.token } })).json();
  assert.equal(mine.address.line1, 'জিন্দাবাজার'); assert.ok(!('token' in mine));
  const pub = await call('GET', `/orders/${r.json.id}/status`);
  assert.deepEqual(pub.json, { id: r.json.id, status: 'DEMO_PLACED', method: 'HOME_DELIVERY' });
  assert.ok(!JSON.stringify(pub.json).includes('01712345678'));
  const mgr = await call('GET', `/admin/orders/${r.json.id}`, { cookie: manager.cookie });
  assert.equal(mgr.json.address.phone, '01712345678', 'managers can see order details');
  assert.ok(!('token' in mgr.json), 'staff views never include the customer token');
});

test('order status: forward only, cancel needs a live order, finished orders are locked', async () => {
  const list = (await call('GET', '/admin/orders', { cookie: admin.cookie })).json.data;
  const home = list.find((o) => o.method === 'HOME_DELIVERY');
  const patch = (id, status) => call('PATCH', `/admin/orders/${id}`, { cookie: admin.cookie, body: { status } });
  assert.equal((await patch(home.id, 'DEMO_PLACED')).status, 409, 'cannot repeat/step back');
  assert.equal((await patch(home.id, 'DEMO_READY_FOR_PICKUP')).status, 409, 'status of another method');
  assert.equal((await patch(home.id, 'DEMO_OUT_FOR_DELIVERY')).status, 200, 'may skip ahead');
  assert.equal((await patch(home.id, 'DEMO_PREPARING')).status, 409);
  assert.equal((await patch(home.id, 'DEMO_CANCELLED')).status, 200);
  assert.equal((await patch(home.id, 'DEMO_DELIVERED')).status, 409);
  assert.equal((await call('GET', `/orders/${home.id}/status`)).json.status, 'DEMO_CANCELLED');
});

test('summary counts products and orders; reset restores the seed', async () => {
  const s = (await call('GET', '/admin/summary', { cookie: manager.cookie })).json;
  assert.equal(s.products.total, 59); assert.equal(s.orders.total, 2); assert.equal(s.orders.byMethod.BULK_ORDER, 1);
  assert.ok(existsSync(join(tmp, 'runtime', 'store.json')), 'state persisted to the runtime file');
  assert.equal((await call('POST', '/admin/reset', { cookie: admin.cookie, body: {} })).status, 200);
  const s2 = (await call('GET', '/admin/summary', { cookie: admin.cookie })).json;
  assert.equal(s2.orders.total, 0); assert.equal(s2.products.noPrice, 59);
});

test('logout ends the session', async () => {
  await call('POST', '/auth/logout', { cookie: manager.cookie });
  assert.equal((await call('GET', '/admin/summary', { cookie: manager.cookie })).status, 401);
});
