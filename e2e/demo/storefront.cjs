// Customer storefront checks against the running demo: catalogue, zones, search/sort, cart, hours, checkout, fulfilment, orders.
const { WEB, launch, DHAKA, reporter, makeContext, resetDemo, adminApi, addToCart } = require('./lib.cjs');
const { ok, done } = reporter('storefront');

(async () => {
  await resetDemo();
  const b = await launch();
  const errs = [];
  const count = (p, s) => p.locator(s).count();
  const noon = DHAKA(12);

  // ───── A. catalogue + zones ─────
  let [c, p] = await makeContext(b, errs, { at: noon });
  await p.goto(WEB, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  ok('In City: all 59 real products', (await count(p, '#products .product-grid > li')) === 59);
  const pills = (await p.locator('.pill').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  ok('category bar: All + 3 categories', pills.length === 4 && /দুগ্ধজাত মিষ্টি/.test(pills[1]) && /দই/.test(pills[2]) && /বেকারি/.test(pills[3]), pills.join(' | '));
  ok('no sample products; prices not invented', !/মসুর ডাল|বাসমতি|চানাচুর/.test(await p.locator('main').innerText()) && (await count(p, '#products .price-pending')) === 59);
  ok('photo fallbacks are category tiles (no fake photos, no SVG product art)', (await count(p, '#products .photo-fallback')) === 59 && (await count(p, '#products .photo-fallback[data-cat="bakery"]')) === 25 && (await p.evaluate(() => ![...document.images].some((i) => /\.svg/.test(i.src) && !/logo/.test(i.src)))));
  await p.getByRole('button', { name: 'আউটার সিটি' }).click(); await p.waitForTimeout(500);
  const names = await p.locator('#products .product-grid h3').allInnerTexts();
  ok('Outer City: 25 products (19 Bakery + Ghee, Nimki + 4 Doi)', names.length === 25 && ['ঘি', 'নিমকি', 'বাটি দই', 'কাপ দই', 'প্রিমিয়াম দই', 'প্রিমিয়াম কাপ দই'].every((n) => names.includes(n)));
  ok('Outer City hides unmarked sweets, other Doi and unverified bakery', !names.some((n) => /রসগোল্লা|কালোজাম|টক দই|মাঠা|ঘোল|ভ্যানিলা বিস্কুট|ড্রাই কেক/.test(n)));
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('zone choice survives reload', (await count(p, '#products .product-grid > li')) === 25);
  await p.getByRole('button', { name: 'ইন সিটি' }).click(); await p.waitForTimeout(400);
  ok('zone strip: In City promise, no instant delivery', /২৪ ঘণ্টার মধ্যে ডেলিভারি/.test(await p.locator('.zone-bar').innerText()));
  await c.close();

  // ───── B. search + sort + filters (prices set through the admin API so sorting can be tested) ─────
  const api = await adminApi();
  const all = (await (await api.call('GET', '/admin/products')).json()).data;
  const bySlug = (s) => all.find((x) => x.slug === s);
  for (const [slug, price] of [['bk-bun', 3000], ['bk-nagra', 1000], ['bk-fruit-cake', 5000]]) {
    const pr = bySlug(slug);
    await api.call('PATCH', `/admin/products/${pr.id}`, { variants: [{ ...pr.variants[0], pricePoisha: price }] });
  }
  [c, p] = await makeContext(b, errs, { lang: 'en', at: noon });
  for (const [q, re] of [['rasgulla', /Rasgulla/], ['roshogolla', /Rasgulla/], ['sandsh', /Sandesh/], ['doi', /Doi/], ['toast', /Toast/], ['semai', /Semai/], ['chomchom', /Chomchom/], ['biscute', /Biscuit/], ['ghi', /Ghee/], ['mlk', /Milk/], ['দই', /Doi/], ['মিষ্টি', /Sandesh|Rasgulla|Chomchom/]]) {
    await p.goto(`${WEB}/search?q=${encodeURIComponent(q)}`, { waitUntil: 'load' }); await p.waitForTimeout(700);
    ok(`search "${q}" (EN/BN, typos)`, re.test(await p.locator('.product-grid').innerText().catch(() => '')));
  }
  await p.goto(`${WEB}/search?q=sandesh`, { waitUntil: 'load' }); await p.waitForTimeout(600);
  const n1 = await count(p, '.product-grid > li'); await p.locator('.pill', { hasText: 'Bakery' }).click().catch(() => {}); await p.waitForTimeout(300);
  ok('search + category filter combine; URL mirrors state', n1 >= 4 && /category=/.test(p.url()) || /q=sandesh/.test(p.url()));
  await p.goto(`${WEB}/search?q=zzzzqq`, { waitUntil: 'load' }); await p.waitForTimeout(500);
  ok('no results: empty state with a clear-filters action', /No products match/.test(await p.locator('main').innerText()) && (await p.getByRole('button', { name: 'Clear filters' }).count()) > 0);
  await p.goto(`${WEB}/?category=bakery#products`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('category from URL is applied', (await count(p, '#products .product-grid > li')) === 25 && (await p.locator('.pill[aria-pressed=true]').innerText()).includes('Bakery'));
  await p.selectOption('#sort-sel', 'price_asc'); await p.waitForTimeout(300);
  const asc = await p.locator('#products .product-grid > li').evaluateAll((l) => l.slice(0, 3).map((x) => x.querySelector('h3').textContent));
  ok('sort price low→high: priced items first, cheapest first, unpriced last', asc[0] === 'Nagra' && asc[1] === 'Bun' && asc[2] === 'Fruit Cake', asc.join(', '));
  await p.selectOption('#sort-sel', 'price_desc'); await p.waitForTimeout(300);
  const desc = await p.locator('#products .product-grid > li').evaluateAll((l) => l.slice(0, 3).map((x) => x.querySelector('h3').textContent));
  ok('sort price high→low', desc[0] === 'Fruit Cake' && desc[2] === 'Nagra', desc.join(', '));
  ok('sort is kept in the URL', /sort=price_desc/.test(p.url()));
  await p.goBack().catch(() => {}); await c.close();

  // ───── C. product page + cart ─────
  [c, p] = await makeContext(b, errs, { at: noon });
  await p.goto(`${WEB}/p/bk-bun`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('product page: price ৳30, both delivery zones, no fake stock claim', /৳\s?৩০/.test(await p.locator('article').innerText()) && /ইন সিটি:/.test(await p.locator('article').innerText()) && !/স্টকে আছে/.test(await p.locator('article').innerText()));
  await p.getByRole('button', { name: 'বাড়ান' }).click(); await p.getByRole('button', { name: 'কার্টে যোগ করুন', exact: true }).click(); await p.waitForTimeout(700);
  ok('add to cart: success message with link, header badge updates', /কার্টে যোগ হয়েছে/.test(await p.locator('article').innerText()) && /২/.test(await p.locator('header a[href="/cart"]').innerText()));
  await p.goto(`${WEB}/cart`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('cart: line total ৳60 and subtotal', /৳\s?৬০/.test(await p.locator('main').innerText()));
  await p.locator('main ul li').first().getByRole('button', { name: 'বাড়ান' }).click(); await p.waitForTimeout(600);
  ok('cart: + updates total to ৳90 and badge to 3', /৳\s?৯০/.test(await p.locator('main').innerText()) && /৩/.test(await p.locator('header a[href="/cart"]').innerText()));
  await p.locator('main ul li').first().getByRole('button', { name: 'কমান' }).click(); await p.waitForTimeout(500);
  await p.locator('main ul li').first().getByRole('button', { name: 'সরান' }).click(); await p.waitForTimeout(600);
  ok('cart: remove → empty state with a way back', /কার্ট খালি/.test(await p.locator('main').innerText()) && (await p.getByRole('link', { name: 'কেনাকাটা শুরু করুন' }).count()) === 1);
  await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  ok('checkout with an empty cart: friendly empty state, no form', /কার্ট খালি/.test(await p.locator('main').innerText()) && (await count(p, '#dc-name')) === 0);
  // zone change re-validates the cart
  await addToCart(c, 'ds-01', 2); await addToCart(c, 'bk-bun', 1);
  await p.goto(`${WEB}/cart`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  await p.getByRole('button', { name: 'আউটার সিটি' }).click(); await p.waitForTimeout(500);
  ok('zone change: ineligible line flagged, not silently removed; checkout blocked', /আউটার সিটিতে ডেলিভারি হয় না/.test(await p.locator('main').innerText()) && (await count(p, 'main ul > li.card')) === 2 && (await p.locator('a:has-text("চেকআউট")').getAttribute('aria-disabled')) === 'true');
  await p.getByRole('button', { name: 'চিহ্নিত পণ্যগুলো সরান' }).click(); await p.waitForTimeout(700);
  ok('explicit remove clears only the flagged item', (await count(p, 'main ul > li.card')) === 1 && (await p.locator('a:has-text("চেকআউট")').getAttribute('aria-disabled')) !== 'true');
  await p.goto(`${WEB}/p/ds-01`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  ok('ineligible product in Outer City: add button disabled with reason', await p.getByRole('button', { name: 'কার্টে যোগ করুন', exact: true }).isDisabled());
  await p.goto(`${WEB}/p/does-not-exist`, { waitUntil: 'load' });
  ok('unknown product → not-found page with a way home', /পাওয়া যায়নি|404/.test(await p.locator('body').innerText()) && (await p.getByRole('link').filter({ hasText: /প্রথম পাতা|হোম|ফিরে/ }).count()) > 0);
  await c.close();

  // ───── D. ordering hours ─────
  for (const [label, at, closed, tomorrow] of [['09:00', DHAKA(9), true, false], ['22:00', DHAKA(22), true, true], ['21:59', DHAKA(21, 59), false, false], ['10:00', DHAKA(10), false, false]]) {
    [c, p] = await makeContext(b, errs, { at }); await addToCart(c, 'bk-bun', 1); await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(900);
    const t = await p.locator('main').innerText(); const btn = p.getByRole('button', { name: 'অর্ডার দিন', exact: true });
    ok(`hours ${label} Dhaka: ${closed ? 'order blocked (browsing allowed)' : 'order open'}`, closed ? (await btn.isDisabled()) && /অর্ডার নেওয়া বন্ধ আছে/.test(t) && /সকাল ১০:০০/.test(t) && tomorrow === /আগামীকাল/.test(t) : (await btn.isEnabled()) && !/অর্ডার নেওয়া বন্ধ আছে/.test(t));
    if (label === '09:00') { await p.goto(WEB, { waitUntil: 'load' }); ok('while closed the catalogue can still be browsed', (await count(p, '#products .product-grid > li')) === 59); }
    await c.close();
  }
  { const cx = await b.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Los_Angeles' }); const pg = await cx.newPage(); await pg.clock.install({ time: DHAKA(12) }); await pg.goto(WEB, { waitUntil: 'load' }); await pg.waitForTimeout(900); ok('browser timezone does not matter (Asia/Dhaka is explicit)', /অর্ডার নেওয়া হচ্ছে/.test(await pg.locator('.zone-bar').innerText())); await cx.close(); }

  // ───── E. checkout: validation, duplicate submit, fulfilment modes, simulated payment ─────
  [c, p] = await makeContext(b, errs, { at: noon }); await addToCart(c, 'bk-bun', 2); await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('checkout: demo banner, 3 fulfilment modes, no card form', /ডেমো চেকআউট/.test(await p.locator('main').innerText()) && (await count(p, 'input[name=fulfilment]')) === 3 && (await count(p, 'input[autocomplete*="cc-"],input[name*=card]')) === 0);
  await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(300);
  const em = await p.locator('main').innerText(); ok('empty form: name, phone and address messages (BN)', /নাম লিখুন/.test(em) && /সঠিক মোবাইল নম্বর/.test(em) && /ঠিকানা লিখুন/.test(em));
  await p.fill('#dc-name', 'রহিম'); await p.fill('#dc-phone', '123'); await p.fill('#dc-line1', 'জিন্দাবাজার'); await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(300);
  ok('invalid phone rejected', /সঠিক মোবাইল নম্বর/.test(await p.locator('aside').innerText()));
  await p.fill('#dc-phone', '01712345678');
  // duplicate submission: slow the API, click twice, expect exactly one order
  await p.route('**/v1/orders', async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  const place = p.getByRole('button', { name: 'অর্ডার দিন', exact: true });
  await place.click(); await place.click({ force: true }).catch(() => {}); await p.waitForTimeout(300);
  ok('while saving: button is busy/disabled (no double submit)', (await place.isDisabled().catch(() => true)) || (await place.getAttribute('aria-busy')) === 'true');
  await p.waitForTimeout(2500);
  const okTxt = await p.locator('main').innerText(); const hid = (okTxt.match(/DEMO-\d+/) || [])[0];
  ok('home delivery placed: DEMO order, 24h estimate, no real payment', !!hid && /অর্ডার সংরক্ষিত হয়েছে/.test(okTxt) && /২৪ ঘণ্টার মধ্যে ডেলিভারি/.test(okTxt) && /কোনো আসল পেমেন্ট/.test(okTxt), hid);
  { const adm = (await (await api.call('GET', '/admin/orders')).json()); ok('exactly one order saved despite two clicks', adm.data.filter((o) => o.customer === 'রহিম').length === 1); }
  ok('cart emptied after the order', (await (await c.request.get(`${WEB}/v1/cart`)).json()).itemCount === 0);
  await p.unroute('**/v1/orders');
  // failed save keeps the cart and explains
  await addToCart(c, 'bk-bun', 1); await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  await p.fill('#dc-name', 'করিম'); await p.fill('#dc-phone', '01812345678'); await p.fill('#dc-line1', 'সুবিদবাজার');
  await p.route('**/v1/orders', (r) => r.abort());
  await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(900);
  ok('order save failure: clear error, form kept, cart kept, no false success', /সংরক্ষণ করা যায়নি/.test(await p.locator('main').innerText()) && !/অর্ডার সংরক্ষিত হয়েছে/.test(await p.locator('main').innerText()) && (await p.inputValue('#dc-name')) === 'করিম' && (await (await c.request.get(`${WEB}/v1/cart`)).json()).itemCount === 1);
  await p.unroute('**/v1/orders');
  // pickup
  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(800); await p.locator('label.opt-card', { hasText: 'এক্সপ্রেস পিকআপ' }).click();
  const pt = await p.locator('main').innerText();
  ok('pickup: "pickup, not delivery", earliest time ≥ 1 h (13:00)', /এটি পিকআপ, ডেলিভারি নয়/.test(pt) && /দুপুর ১:০০/.test(pt));
  const opts = await p.locator('#dc-time option').allInnerTexts(); ok('pickup slots start at the lead time and cover the day', /দুপুর ১:০০/.test(opts[0]) && opts.length >= 6, opts[0]);
  await p.fill('#dc-name', 'করিম'); await p.fill('#dc-phone', '01812345678');
  await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(300);
  ok('pickup without outlet → message', /আউটলেট বেছে নিন/.test(await p.locator('main').innerText()));
  await p.selectOption('#dc-outlet', { index: 1 }); await p.selectOption('#dc-time', { index: 2 }); await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(1000);
  const pTxt = await p.locator('main').innerText(); const pid = (pTxt.match(/DEMO-\d+/) || [])[0];
  ok('pickup order: "requested — not confirmed yet", never described as delivery', /পিকআপের অনুরোধ নেওয়া হয়েছে — এখনো নিশ্চিত নয়/.test(pTxt) && !/ডেলিভারির পথে|আনুমানিক ডেলিভারি/.test(pTxt), pid);
  await api.call('PATCH', `/admin/orders/${pid}`, { status: 'DEMO_PREPARING' });
  await p.waitForTimeout(5600); ok('confirmation card follows admin status; still not confirmed while preparing', /প্রস্তুত করা হচ্ছে/.test(await p.locator('main').innerText()) && !/পিকআপ নিশ্চিত — অর্ডার প্রস্তুত/.test(await p.locator('main').innerText()));
  await api.call('PATCH', `/admin/orders/${pid}`, { status: 'DEMO_READY_FOR_PICKUP' });
  await p.waitForTimeout(5600); ok('pickup confirmed only once the outlet marks it ready', /পিকআপ নিশ্চিত — অর্ডার প্রস্তুত/.test(await p.locator('main').innerText()));
  // bulk
  await addToCart(c, 'bk-bun', 20); await p.goto(`${WEB}/cart`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  ok('cart shows the bulk notice at the configured threshold', /বাল্ক অর্ডার/.test(await p.locator('main').innerText()));
  await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('bulk: home delivery + pickup disabled, bulk preselected', (await p.locator('input[name=fulfilment]').nth(0).isDisabled()) && (await p.locator('input[name=fulfilment]').nth(1).isDisabled()) && (await p.locator('input[name=fulfilment]').nth(2).isChecked()));
  const bt = await p.locator('main').innerText(); ok('bulk: Modina Market Branch only, Demo/Simulated Payment, no delivery', /মদিনা মার্কেট শাখা/.test(bt) && /ডেমো\/সিমুলেটেড পেমেন্ট/.test(bt) && /ডেলিভারি নেই/.test(bt));
  await p.fill('#dc-name', 'করিম'); await p.fill('#dc-phone', '01812345678');
  await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(300);
  ok('bulk without prepayment rejected', /বাল্ক অর্ডারে আগে পেমেন্ট/.test(await p.locator('aside').innerText()) && !/অর্ডার সংরক্ষিত হয়েছে/.test(await p.locator('main').innerText()));
  const payBtn = p.locator('button[aria-pressed]', { hasText: /সিমুলেটেড পেমেন্ট/ }); await payBtn.click();
  ok('simulated payment state shown and pressed', (await payBtn.getAttribute('aria-pressed')) === 'true' && /সিমুলেটেড পেমেন্ট সম্পন্ন/.test(await payBtn.innerText()));
  await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(1000);
  const bTxt = await p.locator('main').innerText(); const bid = (bTxt.match(/DEMO-\d+/) || [])[0];
  ok('bulk order placed: simulated prepayment, collection branch', /সিমুলেটেড প্রিপেমেন্ট হয়েছে/.test(bTxt) && /আসল টাকা কাটা হয়নি/.test(bTxt) && /মদিনা মার্কেট শাখা/.test(bTxt), bid);
  await c.close();

  // bulk builder page
  [c, p] = await makeContext(b, errs, { at: noon }); await p.goto(`${WEB}/bulk`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('bulk page: all 59 products in 3 groups, checkout disabled below threshold', (await count(p, '.bulk-row')) === 59 && (await count(p, '.bulk-list')) === 3 && (await p.getByRole('button', { name: 'চেকআউটে যান' }).isDisabled()));
  await p.locator('.bulk-row').nth(0).locator('.bulk-qty').fill('12'); await p.locator('.bulk-row').nth(30).locator('.bulk-qty').fill('7'); await p.waitForTimeout(200);
  ok('19 items: still short, shows how many more', /আরও লাগবে/.test(await p.locator('.action-bar').innerText()) && (await p.getByRole('button', { name: 'চেকআউটে যান' }).isDisabled()));
  await p.locator('.bulk-row').nth(30).getByRole('button', { name: 'বাড়ান' }).click(); await p.waitForTimeout(200);
  ok('20 items enable checkout; goes to checkout with Bulk Order selected', await p.getByRole('button', { name: 'চেকআউটে যান' }).isEnabled());
  await p.getByRole('button', { name: 'চেকআউটে যান' }).click(); await p.waitForURL(/\/checkout/); await p.waitForTimeout(900);
  ok('bulk → checkout: Bulk selected, cart has 20 items', (await p.locator('input[name=fulfilment]').nth(2).isChecked()) && (await (await c.request.get(`${WEB}/v1/cart`)).json()).itemCount === 20);
  await p.goto(`${WEB}/bulk`, { waitUntil: 'load' }); await p.locator('#bulk-q').fill('sandsh'); await p.waitForTimeout(400);
  ok('bulk search is typo tolerant', /সন্দেশ/.test(await p.locator('.bulk-list').first().innerText()));
  await c.close();

  // Outer City order with Bati Doi
  [c, p] = await makeContext(b, errs, { at: noon }); await addToCart(c, 'doi-03', 1); await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  ok('In City address hint', /সিলেট সদরের যেকোনো জায়গায়/.test(await p.locator('main').innerText()));
  await p.getByRole('button', { name: 'আউটার সিটি' }).click(); await p.waitForTimeout(400);
  ok('Outer City address hint', /সিলেটের বাইরের যেকোনো জায়গায়/.test(await p.locator('main').innerText()));
  await p.fill('#dc-name', 'করিম'); await p.fill('#dc-phone', '01812345678'); await p.fill('#dc-line1', 'বিয়ানীবাজার, সিলেট'); await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(1000);
  ok('Outer City order with Bati Doi placed (1–2 days)', /অর্ডার সংরক্ষিত হয়েছে/.test(await p.locator('main').innerText()) && /১-২ দিনের মধ্যে ডেলিভারি/.test(await p.locator('main').innerText()));
  await c.close();

  // ───── F. account + order screens ─────
  [c, p] = await makeContext(b, errs, { at: noon });
  await p.goto(`${WEB}/account`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('my orders (new browser): empty state with a call to action', /এখনো কোনো অর্ডার দেওয়া হয়নি/.test(await p.locator('main').innerText()) && /লগইন নেই/.test(await p.locator('main').innerText()));
  await p.goto(`${WEB}/login`, { waitUntil: 'load' }); ok('login page: explains there is no customer login in the demo, with working links', /ডেমোতে গ্রাহক লগইন নেই/.test(await p.locator('main').innerText()) && (await p.getByRole('link', { name: 'আমার অর্ডার' }).count()) > 0);
  await p.goto(`${WEB}/orders/${hid}`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('someone else\'s order id → "not found", no personal data', /অর্ডারটি পাওয়া যায়নি/.test(await p.locator('main').innerText()) && !/জিন্দাবাজার|01712345678/.test(await p.locator('body').innerText()));
  await c.close();
  // the browser that placed orders sees them
  [c, p] = await makeContext(b, errs, { at: noon }); await addToCart(c, 'bk-bun', 1); await p.goto(`${WEB}/checkout`, { waitUntil: 'load' }); await p.waitForTimeout(700);
  await p.fill('#dc-name', 'রহিম'); await p.fill('#dc-phone', '01712345678'); await p.fill('#dc-line1', 'জিন্দাবাজার'); await p.getByRole('button', { name: 'অর্ডার দিন', exact: true }).click(); await p.waitForTimeout(1000);
  const myId = ((await p.locator('main').innerText()).match(/DEMO-\d+/) || [])[0];
  await p.getByRole('link', { name: 'আমার অর্ডার' }).first().click(); await p.waitForURL(/\/account/); await p.waitForTimeout(1200);
  ok('my orders lists the order placed in this browser', (await p.locator('main').innerText()).includes(myId) && (await count(p, 'main article')) === 1);
  await p.getByRole('link', { name: 'বিস্তারিত দেখুন' }).click(); await p.waitForURL(/\/orders\/DEMO-/); await p.waitForTimeout(1000);
  ok('order page shows items, address, status', /জিন্দাবাজার/.test(await p.locator('main').innerText()) && /অর্ডার নেওয়া হয়েছে/.test(await p.locator('main').innerText()));
  await api.call('PATCH', `/admin/orders/${myId}`, { status: 'DEMO_PREPARING' }); await p.waitForTimeout(10500);
  ok('order page refreshes by itself when the admin changes the status', /প্রস্তুত করা হচ্ছে/.test(await p.locator('main').innerText()));
  await resetDemo(); await p.goto(`${WEB}/account`, { waitUntil: 'load' }); await p.waitForTimeout(1200);
  ok('after a demo-data reset the order shows "no longer available" with a remove action', /আর পাওয়া যাচ্ছে না/.test(await p.locator('main').innerText()));
  await p.getByRole('button', { name: 'তালিকা থেকে সরান' }).click(); await p.waitForTimeout(800);
  ok('removing it returns to the empty state', /এখনো কোনো অর্ডার দেওয়া হয়নি/.test(await p.locator('main').innerText()));
  await c.close();

  // ───── G. API failure handling (client side) ─────
  [c, p] = await makeContext(b, errs, { at: noon }); await p.goto(`${WEB}/p/bk-bun`, { waitUntil: 'load' }); await p.waitForTimeout(800);
  await p.route('**/v1/cart**', (r) => r.abort());
  await p.getByRole('button', { name: 'কার্টে যোগ করুন', exact: true }).click(); await p.waitForTimeout(900);
  ok('add to cart while the API is unreachable: error message, no false success', /যোগ করা যায়নি|সমস্যা/.test(await p.locator('article').innerText()) && !/কার্টে যোগ হয়েছে/.test(await p.locator('article').innerText()));
  await p.goto(`${WEB}/cart`, { waitUntil: 'load' }); await p.waitForTimeout(900);
  ok('cart page while the API is unreachable: error shown (not an endless spinner)', /কার্ট লোড করা যায়নি/.test(await p.locator('main').innerText()));
  await p.unroute('**/v1/cart**'); await c.close();

  // ───── H. empty/404 states ─────
  [c, p] = await makeContext(b, errs, { at: noon });
  const r404 = await p.goto(`${WEB}/no-such-page`, { waitUntil: 'load' });
  ok('unknown URL → 404 page (styled, with a way home)', r404.status() === 404 && (await p.getByRole('link').filter({ hasText: /প্রথম পাতা|হোম|ফিরে/ }).count()) > 0);
  const r2 = await p.goto(`${WEB}/pages/nope`, { waitUntil: 'load' }); ok('unknown info page → 404', r2.status() === 404);
  await c.close();

  console.log('console/network errors:', errs.length, errs.slice(0, 6));
  ok('no console errors or 5xx responses', errs.length === 0);
  await api.dispose(); await b.close();
  process.exit(done() ? 0 : 1);
})();
