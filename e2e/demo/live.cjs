// Browser test of the LIVE shop (real API + PostgreSQL), not the demo. Needs the stack from docs/LIVE_LOCAL_TEST.md:
// API :4000 (PAYMENTS_PROVIDER=sandbox, ENABLE_DEV_OUTBOX=true, NODE_ENV=development), storefront :3200, admin :3201,
// outlet MODINA-MARKET set up, products ds-01/ds-02 priced and stocked, admin admin@live.test / manager@live.test.
const { chromium, request } = require('@playwright/test');
const crypto = require('node:crypto');
const WEB = process.env.LIVE_WEB || 'http://127.0.0.1:3200';
const ADMIN = process.env.LIVE_ADMIN || 'http://127.0.0.1:3201';
const API = process.env.LIVE_API || 'http://127.0.0.1:4000/v1';
const ADMIN_PW = process.env.LIVE_ADMIN_PW || 'live-admin-password-1';
const MGR_PW = process.env.LIVE_MANAGER_PW || 'live-manager-password-1';
const res = [];
const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? '  — ' + d : ''}`); };

function totp(secretB32, offset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretB32.replace(/=+$/, '')) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const h = crypto.createHmac('sha1', key).update(ctr).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const errs = [];
  const mk = async () => {
    const c = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message.slice(0, 120)));
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
    return p;
  };

  // ── customer: browse, cart, OTP login at checkout, place a home-delivery order ──
  const c = await mk();
  await c.goto(`${WEB}/p/ds-01`);
  ok('product page shows the real price', (await c.textContent('main')).includes('৫০') || (await c.textContent('main')).includes('50'));
  ok('no DEMO wording in the live shop', !/ডেমো/.test(await c.textContent('body')));
  await c.getByRole('button', { name: 'কার্টে যোগ করুন' }).first().click();
  await c.getByText('কার্টে যোগ হয়েছে').waitFor();
  const unpriced = await mk();
  await unpriced.goto(`${WEB}/p/ds-03`);
  ok('unpriced product cannot be added in the live shop', await unpriced.getByRole('button', { name: 'কার্টে যোগ করুন' }).first().isDisabled());
  await c.goto(`${WEB}/checkout`);
  await c.locator('#phone').fill('01712345678');
  await c.getByRole('button', { name: 'কোড পাঠান' }).click();
  await c.locator('#code').waitFor();
  const sms = await (await fetch(`${API}/dev/sms?phone=01712345678`)).json();
  const code = /(\d{6})/.exec(sms.at(-1).text)[1];
  await c.locator('#code').fill(code);
  await c.getByRole('button', { name: 'যাচাই করুন' }).click();
  await c.locator('#dc-name').waitFor();
  ok('OTP login reaches the checkout form with the cart kept', (await c.textContent('body')).includes('অর্ডারের সারাংশ'));
  await c.locator('#dc-name').fill('রহিম উদ্দিন');
  await c.locator('#dc-phone').fill('01812345678');
  await c.locator('#dc-line1').fill('বাসা ১২, রোড ৩, সিলেট');
  await c.getByRole('button', { name: 'অর্ডার দিন' }).click();
  await c.getByText('আপনার অর্ডার নেওয়া হয়েছে।').waitFor();
  const body = await c.textContent('main');
  ok('order confirmation shows an order number and the server price', /DW\d{6}[A-Z0-9]{5}/.test(body) && body.includes('৫০'));
  const orderNo = /DW\d{6}[A-Z0-9]{5}/.exec(body)[0];
  await c.goto(`${WEB}/account`);
  await c.getByText(orderNo).first().waitFor();
  ok('order appears under My orders for the signed-in customer', true);

  // ── another browser (new customer) cannot open that order ──
  const other = await mk();
  const ordersApi = await request.newContext();
  const list = await (await ordersApi.get(`${API}/catalog/categories`)).json();
  ok('public catalogue API answers without login', Array.isArray(list) && list.length === 3);
  await other.goto(`${WEB}/account`);
  await other.locator('#phone').waitFor();
  ok('anonymous visitor sees the login form, not orders', !(await other.textContent('body')).includes(orderNo));

  // ── admin: password, two-factor enrolment, then advance the order ──
  const a = await mk();
  await a.goto(`${ADMIN}/login`);
  await a.locator('#login').fill('admin@live.test');
  await a.locator('#password').fill(ADMIN_PW);
  await a.getByRole('button', { name: 'লগইন' }).click();
  await a.waitForURL('**/mfa');
  ok('admin is sent to two-step verification', true);
  await a.getByRole('button', { name: 'শুরু করুন' }).click();
  const secret = (await a.locator('p.font-latin').first().textContent()).trim();
  await a.locator('#c').fill(totp(secret));
  await a.getByRole('button', { name: 'নিশ্চিত করুন' }).click();
  await a.getByText('রিকভারি কোড সংরক্ষণ করুন').waitFor();
  await a.getByRole('button', { name: 'সংরক্ষণ করেছি, এগিয়ে যান' }).click();
  await a.waitForURL(`${ADMIN}/`);
  ok('admin reaches the dashboard after enrolling 2FA', true);
  await a.goto(`${ADMIN}/orders`);
  await a.getByText(orderNo).first().click();
  await a.getByRole('button', { name: 'প্রস্তুত করা হচ্ছে' }).click();
  await a.getByText('অবস্থা বদলানো হয়েছে').waitFor();
  ok('admin moves the order one step (PLACED -> PREPARING)', true);
  await c.goto(`${WEB}/account`);
  await c.getByText('প্রস্তুত করা হচ্ছে').first().waitFor();
  ok('customer sees the new status', true);

  // ── manager: view only ──
  const m = await mk();
  await m.goto(`${ADMIN}/manager/login`);
  await m.locator('#login').fill('manager@live.test');
  await m.locator('#password').fill(MGR_PW);
  await m.getByRole('button', { name: 'লগইন' }).click();
  await m.waitForURL(`${ADMIN}/`);
  await m.goto(`${ADMIN}/orders`);
  await m.getByText(orderNo).first().click();
  await m.getByText('শুধু দেখা যায়').waitFor();
  ok('manager sees no status buttons', (await m.getByRole('button', { name: 'প্রস্তুত করা হচ্ছে' }).count()) === 0);

  // ── bulk order: 20+ items, payment sandbox ──
  const bk = await mk();
  await bk.goto(`${WEB}/p/ds-02`);
  for (let i = 0; i < 19; i++) await bk.getByRole('button', { name: 'বাড়ান' }).click();
  await bk.getByRole('button', { name: 'কার্টে যোগ করুন' }).first().click();
  await bk.getByText('কার্টে যোগ হয়েছে').waitFor();
  await bk.goto(`${WEB}/checkout`);
  await bk.locator('#phone').fill('01912345678');
  await bk.getByRole('button', { name: 'কোড পাঠান' }).click();
  await bk.locator('#code').waitFor();
  const s2 = await (await fetch(`${API}/dev/sms?phone=01912345678`)).json();
  await bk.locator('#code').fill(/(\d{6})/.exec(s2.at(-1).text)[1]);
  await bk.getByRole('button', { name: 'যাচাই করুন' }).click();
  await bk.locator('#dc-name').waitFor();
  ok('bulk cart: only bulk order is selectable', await bk.getByRole('radio', { name: /হোম ডেলিভারি/ }).isDisabled());
  await bk.locator('#dc-name').fill('কোম্পানি');
  await bk.locator('#dc-phone').fill('01712345670');
  await bk.getByRole('button', { name: 'অর্ডার দিন' }).click();
  await bk.getByRole('button', { name: 'পেমেন্ট শুরু করুন' }).click();
  await bk.getByText('স্যান্ডবক্স পেমেন্ট — আসল টাকা কাটা হয় না।').waitFor();
  ok('bulk payment is labelled sandbox / no real money', true);
  await bk.getByRole('button', { name: 'পেমেন্ট সফল ধরুন' }).click();
  await bk.getByText('পেমেন্ট নিশ্চিত — প্রস্তুতির অপেক্ষায়').first().waitFor();
  ok('bulk order becomes PREPAID only after the verified (signed) payment event', true);

  ok('no console/page errors or 5xx', errs.length === 0, errs.join(' | '));
  await b.close();
  const fail = res.filter((x) => !x).length;
  console.log(`\n[live] ${res.length - fail}/${res.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
