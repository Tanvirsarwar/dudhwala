// Cross-cutting checks: language + Day/Night theme (persistence, system preference, no flash), keyboard + focus, reduced motion,
// responsive overflow, English completeness, and accessibility (axe, WCAG A/AA) in both themes.
const { WEB, ADMIN, launch, DHAKA, reporter, makeContext, resetDemo, addToCart, leftoverBangla } = require('./lib.cjs');
const AxeBuilder = require('@axe-core/playwright').default;
const { ok, done } = reporter('platform');

(async () => {
  await resetDemo();
  const b = await launch(); const errs = [];
  const noon = DHAKA(12);
  const theme = (p) => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const bgLum = (p) => p.evaluate(() => { const [r, g, bl] = getComputedStyle(document.documentElement).backgroundColor.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * bl) / 255; });

  // ───── Day/Night theme ─────
  let [c, p] = await makeContext(b, errs, { at: noon, colorScheme: 'dark' });
  await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('first visit follows the system preference (dark)', (await theme(p)) === 'dark' && (await bgLum(p)) < 0.2);
  await c.close();
  [c, p] = await makeContext(b, errs, { at: noon, colorScheme: 'light' });
  await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('first visit follows the system preference (light)', (await theme(p)) === 'light' && (await bgLum(p)) > 0.8);
  const sw = p.getByRole('group', { name: /থিম|Theme/ });
  ok('theme control is a labelled group of toggle buttons (aria-pressed)', (await sw.getByRole('button').count()) === 2 && (await sw.getByRole('button', { name: 'দিন মোড' }).getAttribute('aria-pressed')) === 'true');
  await sw.getByRole('button', { name: 'রাত মোড' }).click(); await p.waitForTimeout(300);
  ok('toggle switches to Night immediately', (await theme(p)) === 'dark' && (await bgLum(p)) < 0.2);
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(500);
  ok('choice persists across reload', (await theme(p)) === 'dark');
  for (const path of ['/p/bk-bun', '/cart', '/bulk', '/pages/about']) { await p.goto(WEB + path, { waitUntil: 'load' }); await p.waitForTimeout(500); if ((await theme(p)) !== 'dark') ok(`theme kept on ${path}`, false); }
  ok('choice persists across navigation (5 pages)', (await theme(p)) === 'dark');
  await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
  ok('an explicit choice beats later system changes', (await theme(p)) === 'dark');
  await p.evaluate(() => localStorage.removeItem('dw.theme')); await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(400);
  ok('clearing the choice goes back to the system preference', (await theme(p)) === 'light');
  // keyboard operation
  await p.getByRole('button', { name: 'রাত মোড' }).focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  ok('theme toggle works from the keyboard (Enter)', (await theme(p)) === 'dark');
  await p.getByRole('button', { name: 'দিন মোড' }).focus(); await p.keyboard.press('Space'); await p.waitForTimeout(200);
  ok('theme toggle works from the keyboard (Space)', (await theme(p)) === 'light');
  await c.close();
  // no flash: the attribute exists before first paint (checked at DOMContentLoaded, before React hydrates)
  { const cx = await b.newContext({ colorScheme: 'light' }); await cx.addInitScript(() => { try { localStorage.setItem('dw.theme', 'dark'); } catch { /* ignore */ } document.addEventListener('DOMContentLoaded', () => { window.__themeAtDcl = document.documentElement.getAttribute('data-theme'); }); }); const pg = await cx.newPage(); await pg.goto(WEB, { waitUntil: 'load' }); ok('no flash of the wrong theme: data-theme is set before DOMContentLoaded', (await pg.evaluate(() => window.__themeAtDcl)) === 'dark'); await cx.close(); }
  // admin shares the same system
  { const [ac, ap] = await makeContext(b, errs, { colorScheme: 'dark' }); await ap.goto(ADMIN + '/login', { waitUntil: 'load' }); await ap.waitForTimeout(600); ok('admin login follows the system preference', (await theme(ap)) === 'dark');
    await ap.getByRole('button', { name: 'দিন মোড' }).click(); await ap.fill('#login', 'admin@demo.local'); await ap.fill('#password', 'demo1234'); await ap.getByRole('button', { name: 'লগইন', exact: true }).click(); await ap.waitForTimeout(1500);
    ok('admin: choice (Day) persists after sign-in and on every panel page', (await theme(ap)) === 'light');
    for (const path of ['/products', '/orders', '/categories', '/settings']) { await ap.goto(ADMIN + path, { waitUntil: 'load' }); await ap.waitForTimeout(500); if ((await theme(ap)) !== 'light') ok(`admin theme kept on ${path}`, false); }
    await ap.getByRole('button', { name: 'রাত মোড' }).click(); await ap.reload({ waitUntil: 'load' }); await ap.waitForTimeout(500); ok('admin Night mode persists across reload', (await theme(ap)) === 'dark' && (await bgLum(ap)) < 0.2);
    await ac.close(); }

  // ───── language switch ─────
  [c, p] = await makeContext(b, errs, { at: noon }); await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'EN', exact: true }).click(); await p.waitForTimeout(500);
  ok('EN switch translates the page and sets <html lang>', /Dairy Sweets/.test(await p.locator('.pill').nth(1).innerText()) && (await p.evaluate(() => document.documentElement.lang)) === 'en');
  await p.goto(WEB + '/cart', { waitUntil: 'load' }); await p.waitForTimeout(500); ok('language persists across navigation', /empty|Start shopping/i.test(await p.locator('main').innerText()));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(500); ok('language persists across reload', (await p.evaluate(() => document.documentElement.lang)) === 'en');
  await p.getByRole('button', { name: 'বাংলা' }).click(); await p.waitForTimeout(400); ok('switching back restores Bangla exactly', /কার্ট খালি/.test(await p.locator('main').innerText()));
  await c.close();

  // ───── English completeness on every customer page (no hydration errors either) ─────
  [c, p] = await makeContext(b, errs, { at: noon, lang: 'en' }); await addToCart(c, 'bk-bun', 2);
  for (const path of ['/', '/p/bk-bun', '/p/ds-01', '/cart', '/checkout', '/bulk', '/account', '/login', '/search?q=doi', '/pages/about', '/pages/faq', '/pages/delivery-policy', '/c/bakery']) {
    await p.goto(WEB + path, { waitUntil: 'load' }); await p.waitForTimeout(1100); const left = await leftoverBangla(p);
    ok(`EN: ${path} fully translated`, left.length === 0, left.slice(0, 4).join(' | '));
  }
  await p.goto(WEB + '/checkout', { waitUntil: 'load' }); await p.waitForTimeout(700); await p.getByRole('button', { name: 'Place order', exact: true }).click(); await p.waitForTimeout(300);
  ok('EN: checkout validation messages translated', (await leftoverBangla(p)).length === 0);
  await c.close();

  // ───── keyboard + focus ─────
  [c, p] = await makeContext(b, errs, { at: noon }); await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.keyboard.press('Tab');
  ok('first Tab reveals the "skip to content" link', (await p.evaluate(() => document.activeElement?.textContent?.trim())) === 'মূল বিষয়ে যান');
  await p.keyboard.press('Enter'); await p.waitForTimeout(200); ok('skip link moves to the main content', /#main/.test(p.url()));
  let bad = 0, seen = 0; await p.goto(WEB, { waitUntil: 'load' });
  for (let i = 0; i < 14; i++) { await p.keyboard.press('Tab'); const o = await p.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e); return { w: parseFloat(s.outlineWidth), st: s.outlineStyle, sh: s.boxShadow }; }); if (o) { seen++; if (!(o.w >= 2 && o.st !== 'none') && o.sh === 'none') bad++; } }
  ok('keyboard focus is visibly outlined on the first 14 tab stops', seen >= 10 && bad === 0, `${seen} stops, ${bad} without a visible indicator`);
  await p.locator('.pill').nth(1).focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400); ok('category pill operable with Enter', (await p.locator('.pill[aria-pressed=true]').innerText()).includes('দুগ্ধজাত'));
  await p.goto(WEB + '/search', { waitUntil: 'load' }); await p.locator('#search-q').focus(); await p.keyboard.type('mlk'); await p.waitForTimeout(500); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await p.waitForURL(/\/p\//, { timeout: 8000 }).then(() => ok('search suggestions: arrows + Enter open the product', true), () => ok('search suggestions: arrows + Enter open the product', false));
  await c.close();

  // ───── reduced motion ─────
  [c, p] = await makeContext(b, errs, { at: noon, reducedMotion: 'reduce' }); await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(500);
  const dur = await p.evaluate(() => { const e = document.querySelector('.reveal'); return e ? parseFloat(getComputedStyle(e).animationDuration) : -1; });
  ok('prefers-reduced-motion: entrance animations are effectively off', dur >= 0 && dur < 0.01, `${dur}s`);
  await p.locator('#products .product-grid > li').nth(3).hover(); await p.waitForTimeout(300);
  ok('prefers-reduced-motion: no hover lift/tilt transform', (await p.locator('#products .product-grid > li .card-lift').nth(3).evaluate((e) => getComputedStyle(e).transform)) === 'none');
  await c.close();

  // ───── responsive ─────
  for (const [w, h] of [[360, 740], [412, 915], [768, 1024], [1280, 800], [1920, 1000]]) {
    [c, p] = await makeContext(b, errs, { vp: { width: w, height: h }, at: noon }); await addToCart(c, 'bk-bun', 1);
    const paths = ['/', '/p/bk-bun', '/cart', '/checkout', '/bulk', '/account', '/pages/about'];
    let worst = 0, where = '';
    for (const path of paths) { await p.goto(WEB + path, { waitUntil: 'load' }); await p.waitForTimeout(500); const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > worst) { worst = ov; where = path; } }
    ok(`${w}px: no horizontal overflow on ${paths.length} customer pages`, worst <= 1, where ? `${where} +${worst}` : '');
    if (w <= 412) { await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(500); const small = await p.evaluate(() => [...document.querySelectorAll('main button, main a.btn, header a, header button')].filter((e) => !e.classList.contains('sr-only') && !e.closest('.sr-only')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; }).length); ok(`${w}px: tap targets are at least 32 px tall`, small === 0, `${small} too small`); }
    await c.close();
  }

  // ───── admin responsive ─────
  for (const [w, h] of [[360, 740], [768, 1024], [1440, 900]]) {
    const [ac, ap] = await makeContext(b, errs, { vp: { width: w, height: h } }); await ap.goto(ADMIN + '/login', { waitUntil: 'load' }); await ap.fill('#login', 'admin@demo.local'); await ap.fill('#password', 'demo1234'); await ap.getByRole('button', { name: 'লগইন', exact: true }).click(); await ap.waitForTimeout(1500);
    const pid = (await (await ac.request.get(ADMIN + '/v1/admin/products')).json()).data[0].id; let worst = 0, where = '';
    for (const path of ['/', '/products', '/products/' + pid, '/categories', '/orders', '/settings']) { await ap.goto(ADMIN + path, { waitUntil: 'load' }); await ap.waitForTimeout(700); const ov = await ap.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (ov > worst) { worst = ov; where = path.replace(pid, ':id'); } }
    ok(`${w}px: no horizontal overflow on 6 admin pages`, worst <= 1, where ? `${where} +${worst}` : ''); await ac.close();
  }

  // ───── accessibility scan (WCAG A/AA) in both themes ─────
  for (const t of ['light', 'dark']) {
    [c, p] = await makeContext(b, errs, { at: noon, theme: t }); await addToCart(c, 'bk-bun', 2);
    let v = [];
    for (const path of ['/', '/p/bk-bun', '/p/ds-01', '/cart', '/checkout', '/bulk', '/pages/about', '/account', '/login', '/search?q=doi', '/no-such']) { await p.goto(WEB + path, { waitUntil: 'load' }); await p.waitForTimeout(900); const r = await new AxeBuilder({ page: p }).withTags(['wcag2a', 'wcag2aa']).analyze(); v.push(...r.violations.map((x) => `${path} ${x.id}`)); }
    ok(`axe (${t}): storefront has no A/AA violations`, v.length === 0, v.slice(0, 5).join(' | ')); await c.close();
    const [ac, ap] = await makeContext(b, errs, { theme: t }); v = [];
    for (const path of ['/login', '/manager/login']) { await ap.goto(ADMIN + path, { waitUntil: 'load' }); await ap.waitForTimeout(600); const r = await new AxeBuilder({ page: ap }).withTags(['wcag2a', 'wcag2aa']).analyze(); v.push(...r.violations.map((x) => `${path} ${x.id}`)); }
    await ap.goto(ADMIN + '/login'); await ap.fill('#login', 'admin@demo.local'); await ap.fill('#password', 'demo1234'); await ap.getByRole('button', { name: 'লগইন', exact: true }).click(); await ap.waitForTimeout(1500);
    const pid = (await (await ac.request.get(ADMIN + '/v1/admin/products')).json()).data[0].id;
    for (const path of ['/', '/products', '/products/' + pid, '/categories', '/orders', '/settings']) { await ap.goto(ADMIN + path, { waitUntil: 'load' }); await ap.waitForTimeout(1000); const r = await new AxeBuilder({ page: ap }).withTags(['wcag2a', 'wcag2aa']).analyze(); v.push(...r.violations.map((x) => `${path.replace(pid, ':id')} ${x.id}`)); }
    ok(`axe (${t}): admin has no A/AA violations`, v.length === 0, v.slice(0, 5).join(' | ')); await ac.close();
  }

  console.log('console/page errors:', errs.length, errs.slice(0, 5));
  ok('no console/page errors (incl. hydration) during these checks', errs.length === 0);
  await b.close(); process.exit(done() ? 0 : 1);
})();
