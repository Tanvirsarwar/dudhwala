// Dudhwala local DEMO API. Zero dependencies (Node >= 22). Serves invented sample data only:
// no database, no payments, no SMS, no network access. State lives in memory and resets on restart.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { categories, products, areas, collections, pages, outlets, orders } from './data.mjs';

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);
const HOST = process.env.MOCK_API_HOST ?? '127.0.0.1';
const DEMO_ADMIN = { login: 'admin@demo.local', password: 'demo1234' };
const DEMO_MSG = 'ডেমো মোড: এই কাজটি সংরক্ষণ হয় না (শুধু দেখার জন্য)।';
let PERMISSIONS = ['orders.read', 'catalog.read_admin', 'inventory.read'];
try {
  PERMISSIONS = [...(await import('../../packages/shared/dist/index.js')).PERMISSIONS];
} catch {
  /* shared package not built yet: the start script builds it first */
}

const carts = new Map(); // cookie id -> { areaId, lines: Map<variantId, qty> }
const variants = new Map(products.flatMap((p) => p.variants.map((v) => [v.id, { p, v }])));
const imgUrl = (p) => `/v1/media/demo/${p.slug}.svg`;
const avail = (v) => (v.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');

// ── illustrations (own artwork, generated; no third-party photos) ──
const HUE = { milk: 214, curd: 190, 'ghee-butter': 42, sweets: 340, cheese: 52, bakery: 28, snacks: 8, gur: 34, biscuits: 160, grocery: 100 };
function art(p) {
  const h = HUE[p.categorySlug] ?? 210;
  const glyph = {
    bottle: '<rect x="330" y="210" width="140" height="70" rx="20" fill="#fff"/><rect x="290" y="270" width="220" height="330" rx="46" fill="#fff"/><rect x="290" y="400" width="220" height="110" fill="#2d308f" opacity=".85"/>',
    cup: '<path d="M250 330h300l-34 260q-4 28-32 28H316q-28 0-32-28z" fill="#fff"/><rect x="236" y="300" width="328" height="44" rx="20" fill="#2d308f" opacity=".9"/>',
    jar: '<rect x="290" y="250" width="220" height="60" rx="16" fill="#2d308f" opacity=".9"/><rect x="262" y="300" width="276" height="300" rx="48" fill="#fff"/><rect x="262" y="400" width="276" height="90" fill="#f2b705" opacity=".9"/>',
    block: '<path d="M240 400l160-110 160 110v170H240z" fill="#fff"/><path d="M240 400l160 100 160-100" fill="none" stroke="#2d308f" stroke-width="10" opacity=".7"/>',
    sweet: '<circle cx="330" cy="470" r="86" fill="#fff"/><circle cx="470" cy="470" r="86" fill="#fff"/><circle cx="400" cy="360" r="86" fill="#fff"/>',
    pouch: '<path d="M270 250h260l30 40-20 300q-2 24-26 24H286q-24 0-26-24L240 290z" fill="#fff"/><path d="M250 300q40 24 75 0t75 0 75 0 55 0" fill="none" stroke="#2d308f" stroke-width="10" opacity=".8"/><rect x="300" y="400" width="200" height="110" rx="20" fill="#2d308f" opacity=".85"/>',
    cookie: '<circle cx="400" cy="430" r="170" fill="#fff"/><circle cx="350" cy="380" r="16" fill="#2d308f" opacity=".7"/><circle cx="450" cy="400" r="16" fill="#2d308f" opacity=".7"/><circle cx="390" cy="480" r="16" fill="#2d308f" opacity=".7"/><circle cx="470" cy="490" r="14" fill="#2d308f" opacity=".7"/><circle cx="330" cy="470" r="14" fill="#2d308f" opacity=".7"/>',
    sack: '<path d="M290 270q110-40 220 0l50 330q4 28-24 28H264q-28 0-24-28z" fill="#fff"/><rect x="310" y="250" width="180" height="34" rx="14" fill="#2d308f" opacity=".9"/><rect x="320" y="400" width="160" height="100" rx="18" fill="#2d308f" opacity=".8"/>',
    loaf: '<rect x="230" y="360" width="340" height="210" rx="100" fill="#fff"/><path d="M300 360q20-60 50 0M380 360q20-60 50 0M460 360q20-60 50 0" fill="#fff" stroke="#2d308f" stroke-width="8" opacity=".9"/>',
  }[p.kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${p.nameEn}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 70% 82%)"/><stop offset="1" stop-color="hsl(${h} 60% 62%)"/></linearGradient></defs><rect width="800" height="800" fill="url(#g)"/>${glyph}<text x="400" y="740" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#23315e" opacity=".55">DEMO ARTWORK</text></svg>`;
}

// ── storefront ──
const cardOf = (p) => ({
  id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, categorySlug: p.categorySlug,
  image: { url: imgUrl(p), altBn: p.nameBn },
  fromPricePoisha: Math.min(...p.variants.map((v) => v.pricePoisha)),
  inStock: p.variants.some((v) => v.stock > 0),
  variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v) })),
});
function list(q) {
  let r = [...products];
  if (q.category) r = r.filter((p) => p.categorySlug === q.category);
  const col = collections.find((c) => c.slug === q.collection);
  if (q.collection) r = col ? r.filter((p) => col.slugs.includes(p.slug)) : [];
  if (q.q) { const t = q.q.toLowerCase(); r = r.filter((p) => p.nameBn.toLowerCase().includes(t) || p.nameEn.toLowerCase().includes(t)); }
  if (q.inStock === 'true') r = r.filter((p) => p.variants.some((v) => v.stock > 0));
  const price = (p) => Math.min(...p.variants.map((v) => v.pricePoisha));
  if (q.sort === 'price_asc') r.sort((a, b) => price(a) - price(b));
  else if (q.sort === 'price_desc') r.sort((a, b) => price(b) - price(a));
  else if (q.sort === 'newest') r.sort((a, b) => b.createdOrder - a.createdOrder);
  const limit = Math.min(48, Math.max(1, Number(q.limit) || 24)), page = Math.max(1, Number(q.page) || 1);
  return { data: r.slice((page - 1) * limit, page * limit).map(cardOf), page, limit, total: r.length, areaChecked: Boolean(q.areaId) };
}
function detail(p, areaChecked) {
  return {
    id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn,
    category: { slug: p.category.slug, nameBn: p.category.nameBn, nameEn: p.category.nameEn },
    images: [{ url: imgUrl(p), altBn: p.nameBn, altEn: p.nameEn, width: 800, height: 800 }],
    content: { descriptionBn: p.descriptionBn, descriptionEn: null },
    variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v), maxQty: v.maxQty })),
    areaChecked,
  };
}
function cartView(c) {
  const lines = [...c.lines].map(([id, quantity]) => {
    const { p, v } = variants.get(id);
    return { variantId: id, productSlug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, labelBn: v.labelBn, image: imgUrl(p), unitPricePoisha: v.pricePoisha, quantity, lineTotalPoisha: v.pricePoisha * quantity, available: v.stock > 0, maxQty: v.maxQty };
  });
  return { id: c.id, areaId: c.areaId, couponCode: null, lines, subtotalPoisha: lines.reduce((s, l) => s + l.lineTotalPoisha, 0), itemCount: lines.reduce((s, l) => s + l.quantity, 0), warnings: [], areaChecked: Boolean(c.areaId) };
}

// ── admin (read-only demo) ──
const adminMe = { user: { id: '00000000-0000-4000-8000-000000000001', fullName: 'ডেমো সুপার অ্যাডমিন', email: DEMO_ADMIN.login, phone: null, mfaEnabled: true }, role: 'SUPER_ADMIN', outletId: null, mfaVerified: true };
const inv = (o) => products.flatMap((p) => p.variants.map((v, i) => ({ variantId: v.id, sku: v.sku, name: `${p.nameBn} · ${v.labelBn}`, onHand: v.stock, reserved: i % 3, onlineBuffer: 2, availableOnline: Math.max(0, v.stock - (i % 3) - 2), lowStockThreshold: 10, lowStock: v.stock < 10, isListed: true, version: 1 })));
const adminProduct = (p) => ({ id: p.id, categoryId: p.category.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, descriptionBn: p.descriptionBn, ingredientsBn: null, allergensBn: null, storageBn: null, shelfLifeBn: null, status: 'ACTIVE', contentApprovedAt: '2026-01-01T00:00:00.000Z', category: { slug: p.category.slug, nameBn: p.category.nameBn }, variants: p.variants.map((v) => ({ id: v.id, sku: v.sku, labelBn: v.labelBn, labelEn: null, packSize: v.packSize, packUnit: v.packUnit, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, status: 'ACTIVE', sortOrder: v.sortOrder })), images: [{ id: `${p.id}-img`, url: imgUrl(p), altBn: p.nameBn, sortOrder: 0 }] });
function ordersView(q) {
  let r = [...orders];
  if (q.status) r = r.filter((o) => o.status === q.status);
  if (q.q) r = r.filter((o) => (o.orderNumber + o.shipName).toLowerCase().includes(q.q.toLowerCase()));
  return { data: r, total: r.length, page: 1 };
}
function dashboard() {
  const open = {};
  for (const o of orders) if (!['DELIVERED', 'CANCELLED'].includes(o.status)) open[o.status] = (open[o.status] ?? 0) + 1;
  return { date: '২০২৬-০১-১৫', openByStatus: open, todayOrders: orders.length, todayRevenuePoisha: orders.filter((o) => o.status !== 'CANCELLED').reduce((s, o) => s + o.totalPoisha, 0), lowStockItems: inv().filter((r) => r.lowStock).length, lateOrders: orders.filter((o) => o.late).length };
}

// ── http plumbing ──
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'content-type': isStr ? 'image/svg+xml' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-demo-mode': 'true', ...headers });
  res.end(status === 204 ? undefined : isStr ? body : JSON.stringify(body));
};
const err = (res, status, code, message) => send(res, status, { error: { code, message, requestId: 'demo' } });
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
const body = (req) => new Promise((ok) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch { ok({}); } }); });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/v1/, '') || '/';
  const q = Object.fromEntries(url.searchParams);
  const ck = cookies(req);
  const customer = req.headers['x-dw-audience'] === 'customer';
  const m = req.method;
  try {
    if (m === 'OPTIONS') return send(res, 204, null);
    if (path === '/health/ready' || path === '/health/live') return send(res, 200, { status: 'ok', demo: true });
    if (path === '/auth/csrf') return send(res, 200, { csrfToken: 'demo-token' });
    let mm;
    if ((mm = path.match(/^\/media\/demo\/([a-z-]+)\.svg$/))) {
      const p = products.find((x) => x.slug === mm[1]);
      return p ? send(res, 200, art(p), { 'cache-control': 'public, max-age=3600' }) : err(res, 404, 'NOT_FOUND', 'Not found');
    }

    // storefront reads
    if (m === 'GET' && path === '/catalog/categories') return send(res, 200, categories.map(({ active, sortOrder, ...c }) => c));
    if (m === 'GET' && path === '/catalog/products') return send(res, 200, list(q));
    if (m === 'GET' && (mm = path.match(/^\/catalog\/products\/([a-z0-9-]+)$/))) {
      const p = products.find((x) => x.slug === mm[1]);
      return p ? send(res, 200, detail(p, Boolean(q.areaId))) : err(res, 404, 'NOT_FOUND', 'পণ্য পাওয়া যায়নি');
    }
    if (m === 'GET' && path === '/content/home') return send(res, 200, { banners: [], collections: collections.map(({ slug, titleBn }) => ({ slug, titleBn })), pages: pages.map(({ slug, titleBn }) => ({ slug, titleBn })), maintenance: false });
    if (m === 'GET' && (mm = path.match(/^\/content\/pages\/([a-z-]+)$/))) {
      const pg = pages.find((x) => x.slug === mm[1]);
      return pg ? send(res, 200, pg) : err(res, 404, 'NOT_FOUND', 'পাতা পাওয়া যায়নি');
    }
    if (m === 'GET' && path === '/delivery/areas') return send(res, 200, areas);
    if (m === 'GET' && path === '/delivery/check') return send(res, 200, { serviceable: true });

    // cart (the only storefront write that works)
    if (path === '/cart' || path.startsWith('/cart/')) {
      let id = ck.dw_cart;
      if (!id || !carts.has(id)) { id = randomUUID(); carts.set(id, { id, areaId: null, lines: new Map() }); }
      const c = carts.get(id);
      const hdr = { 'set-cookie': `dw_cart=${id}; Path=/; HttpOnly; SameSite=Lax` };
      if (m === 'GET' && path === '/cart') return send(res, 200, cartView(c), hdr);
      if (m === 'PUT' && (mm = path.match(/^\/cart\/items\/([0-9a-f-]{36})$/))) {
        const hit = variants.get(mm[1]);
        if (!hit) return err(res, 404, 'NOT_FOUND', 'পণ্য পাওয়া যায়নি');
        const qty = Number((await body(req)).quantity);
        if (!Number.isInteger(qty) || qty < 0) return err(res, 400, 'VALIDATION_FAILED', 'সংখ্যা সঠিক নয়');
        if (qty > hit.v.maxQty) return err(res, 409, 'CONFLICT', `সর্বোচ্চ ${hit.v.maxQty}টি নেওয়া যাবে`);
        if (qty === 0) c.lines.delete(mm[1]); else c.lines.set(mm[1], qty);
        return send(res, 200, cartView(c), hdr);
      }
      if (m === 'PUT' && path === '/cart/area') { c.areaId = (await body(req)).areaId ?? null; return send(res, 200, cartView(c), hdr); }
    }

    // sign-in
    if (m === 'POST' && path === '/auth/staff/login') {
      const b = await body(req);
      if (b.login !== DEMO_ADMIN.login || b.password !== DEMO_ADMIN.password) return err(res, 401, 'UNAUTHENTICATED', 'ইমেইল বা পাসওয়ার্ড সঠিক নয়');
      return send(res, 200, { mfaRequired: false, mfaEnrolled: true }, { 'set-cookie': 'dw_admin_sid=demo; Path=/; HttpOnly; SameSite=Lax' });
    }
    if (m === 'POST' && path === '/auth/logout') return send(res, 204, null, { 'set-cookie': 'dw_admin_sid=; Path=/; Max-Age=0' });
    if (path === '/me') {
      if (customer || ck.dw_admin_sid !== 'demo') return err(res, 401, 'UNAUTHENTICATED', 'লগইন করা নেই');
      return send(res, 200, { ...adminMe, permissions: PERMISSIONS });
    }

    // admin reads (login required)
    if (path.startsWith('/admin/') || path.startsWith('/rider/')) {
      if (ck.dw_admin_sid !== 'demo') return err(res, 401, 'UNAUTHENTICATED', 'লগইন করা নেই');
      if (m !== 'GET') return err(res, 503, 'DEMO_MODE', DEMO_MSG);
      if (path === '/admin/dashboard') return send(res, 200, dashboard());
      if (path === '/admin/outlets') return send(res, 200, outlets);
      if (path === '/admin/orders' || /^\/admin\/outlets\/[^/]+\/orders$/.test(path)) return send(res, 200, ordersView(q));
      if (path === '/admin/products') return send(res, 200, products.map(adminProduct));
      if ((mm = path.match(/^\/admin\/products\/([0-9a-f-]{36})$/))) { const p = products.find((x) => x.id === mm[1]); return p ? send(res, 200, adminProduct(p)) : err(res, 404, 'NOT_FOUND', 'Not found'); }
      if (path === '/admin/categories') return send(res, 200, categories);
      if (/^\/admin\/outlets\/[^/]+\/inventory$/.test(path)) return send(res, 200, inv());
      if (path === '/admin/areas') return send(res, 200, areas.map((a) => ({ ...a, active: true })));
      if (path.startsWith('/admin/orders/')) return err(res, 503, 'DEMO_MODE', 'ডেমোতে অর্ডারের বিস্তারিত পাতা নেই।');
      return send(res, 200, []); // other admin screens render empty in the demo
    }

    // everything else that would need a database, SMS or payment gateway
    if (m !== 'GET') return err(res, 503, 'DEMO_MODE', DEMO_MSG);
    return err(res, 404, 'NOT_FOUND', 'এই ডেমোতে এটি নেই');
  } catch (e) {
    return err(res, 500, 'DEMO_ERROR', String(e?.message ?? e));
  }
}).listen(PORT, HOST, () => console.log(`Dudhwala DEMO API (sample data, no database) on http://${HOST}:${PORT}/v1`));
