// Server-side failure handling: stops the demo API, checks that pages explain the problem and offer a retry, then restarts the API and checks recovery.
// Local-demo only (it kills and restarts demo/mock-api/server.mjs). Skip with SKIP_RESILIENCE=1.
const { execSync, spawn } = require('node:child_process');
const path = require('node:path');
const { WEB, ADMIN, launch, reporter, makeContext, resetDemo } = require('./lib.cjs');
const { ok, done } = reporter('resilience');
const SERVER = path.resolve(__dirname, '../../demo/mock-api/server.mjs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiUp = () => fetch(`${WEB}/v1/health/ready`).then((r) => r.ok, () => false);

(async () => {
  if (process.env.SKIP_RESILIENCE === '1') { console.log('skipped (SKIP_RESILIENCE=1)'); return; }
  await resetDemo();
  const b = await launch(); const errs = [];
  let [c, p] = await makeContext(b, errs);
  await p.goto(WEB, { waitUntil: 'load' }); ok('baseline: storefront up', (await p.locator('#products .product-grid > li').count()) === 59);

  // kill by port (never by command-line pattern: that can match the shell running this test)
  try { execSync(`fuser -k ${process.env.MOCK_API_PORT || 4010}/tcp`, { stdio: 'ignore' }); } catch { /* nothing listening */ }
  for (let i = 0; i < 30 && (await apiUp()); i++) await sleep(200);
  ok('API is down for the test', !(await apiUp()));

  await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('home page with the API down: friendly error + retry, not a blank page', /কিছু একটা সমস্যা হয়েছে/.test(await p.locator('body').innerText()) && (await p.getByRole('button', { name: 'আবার চেষ্টা করুন' }).count()) === 1);
  await p.goto(`${WEB}/p/bk-bun`, { waitUntil: 'load' }); await p.waitForTimeout(500);
  ok('product page with the API down: same friendly error', /কিছু একটা সমস্যা হয়েছে/.test(await p.locator('body').innerText()));
  await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  ok('checkout with the API down: error + retry (no spinner forever, no form)', /কার্ট লোড করা যায়নি/.test(await p.locator('main').innerText()) && (await p.locator('#dc-name').count()) === 0);
  const [ac, ap] = await makeContext(b, errs); await ap.goto(`${ADMIN}/login`, { waitUntil: 'load' }); await ap.fill('#login', 'admin@demo.local'); await ap.fill('#password', 'demo1234'); await ap.getByRole('button', { name: 'লগইন', exact: true }).click(); await ap.waitForTimeout(1200);
  ok('admin login with the API down: error message, not a crash', /সঠিক নয়|সমস্যা|Failed|Request failed|Something went wrong|ERROR|fetch/i.test(await ap.locator('main').innerText()) || (await ap.locator('[role=alert]').count()) > 0);

  spawn(process.execPath, [SERVER], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 50 && !(await apiUp()); i++) await sleep(200);
  ok('API restarted (data kept in runtime/store.json)', await apiUp());
  await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('storefront recovers without a restart', (await p.locator('#products .product-grid > li').count()) === 59);
  await ac.close(); await c.close(); await b.close();
  process.exit(done() ? 0 : 1);
})();
