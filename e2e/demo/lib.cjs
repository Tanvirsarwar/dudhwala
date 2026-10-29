// Shared helpers for the demo browser tests. Run them against a running demo (./start-demo.sh): `pnpm test:demo:browser`.
// Env: WEB_URL, ADMIN_URL (defaults to the local demo), PW_CHROMIUM_PATH (use an installed Chromium instead of Playwright's own).
const { chromium, request } = require('@playwright/test');
const WEB = process.env.WEB_URL || 'http://127.0.0.1:3100';
const ADMIN = process.env.ADMIN_URL || 'http://127.0.0.1:3101';
const launch = () => chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
/** Dhaka wall clock (UTC+6) -> instant */
const DHAKA = (h, m = 0, day = 10) => new Date(Date.UTC(2026, 2, day, h - 6, m));

function reporter(name) {
  const res = [];
  const ok = (n, c, d = '') => { res.push(!!c); console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? '  — ' + d : ''}`); return !!c; };
  const done = () => { const f = res.filter((x) => !x).length; console.log(`\n[${name}] ${res.length - f}/${res.length} passed`); return f === 0; };
  return { ok, done };
}

/** New browser context + page with console/5xx error capture. */
async function makeContext(b, errs, { vp = { width: 1366, height: 900 }, lang = 'bn', theme, at, colorScheme, reducedMotion } = {}) {
  const c = await b.newContext({ viewport: vp, ...(colorScheme ? { colorScheme } : {}), ...(reducedMotion ? { reducedMotion } : {}) });
  await c.addInitScript(([l, t]) => { try { if (!localStorage.getItem('dw.lang')) localStorage.setItem('dw.lang', l); if (t && !localStorage.getItem('dw.theme')) localStorage.setItem('dw.theme', t); } catch { /* ignore */ } }, [lang, theme || '']);
  const p = await c.newPage();
  if (at) await p.clock.install({ time: at });
  p.on('pageerror', (e) => errs.push('PAGEERR ' + p.url().replace(/^https?:\/\/[^/]+/, '') + ' ' + e.message.slice(0, 110)));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 140)); });
  p.on('response', (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 90)}`); });
  return [c, p];
}

/** Resets the demo data through the admin API (demo only). */
async function resetDemo() {
  const r = await request.newContext();
  await r.post(`${ADMIN}/v1/auth/staff/login`, { data: { login: 'admin@demo.local', password: 'demo1234', as: 'admin' } });
  const x = await r.post(`${ADMIN}/v1/admin/reset`, { data: {}, headers: { 'x-csrf-token': 't' } });
  await r.dispose();
  if (!x.ok()) throw new Error('could not reset the demo data (is the demo running?)');
}
async function adminApi() {
  const r = await request.newContext();
  await r.post(`${ADMIN}/v1/auth/staff/login`, { data: { login: 'admin@demo.local', password: 'demo1234', as: 'admin' } });
  const call = (method, path, data) => r.fetch(`${ADMIN}/v1${path}`, { method, data, headers: { 'x-csrf-token': 't' } });
  return { call, dispose: () => r.dispose() };
}
const addToCart = async (ctx, slug, n = 1) => {
  const pr = await (await ctx.request.get(`${WEB}/v1/catalog/products/${slug}`)).json();
  await ctx.request.put(`${WEB}/v1/cart/items/${pr.variants[0].id}`, { data: { quantity: n } });
  return pr.variants[0].id;
};
/** Bangla text left on the page while English is selected (text nodes + labels), ignoring the language switch and currency sign. */
const leftoverBangla = (p) => p.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const v = n.nodeValue.trim();
    const el = n.parentElement;
    if (/[ঀ-৿]/.test(v.replace(/৳/g, '')) && !['SCRIPT', 'STYLE'].includes(el.tagName) && !el.closest('.seg-group')) out.push(v);
  }
  document.querySelectorAll('[aria-label],[placeholder],[title]').forEach((e) => {
    for (const a of ['aria-label', 'placeholder', 'title']) {
      const v = e.getAttribute(a);
      if (v && /[ঀ-৿]/.test(v) && !/^(Language|থিম)/.test(v)) out.push(`${a}:${v}`);
    }
  });
  document.querySelectorAll('option').forEach((o) => { if (/[ঀ-৿]/.test(o.textContent.replace(/৳/g, ''))) out.push(o.textContent.trim()); });
  return [...new Set(out)];
});

module.exports = { WEB, ADMIN, launch, DHAKA, reporter, makeContext, resetDemo, adminApi, addToCart, leftoverBangla };
