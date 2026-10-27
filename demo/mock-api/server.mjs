// Dudhwala local DEMO API. Zero dependencies (Node >= 22). Serves invented sample data only:
// no database, no payments, no SMS, no network access. State lives in memory and resets on restart.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
// stock === null means "not tracked in this demo": shown as available, never as a quantity
const avail = (v) => (v.stock === null || v.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
const minPrice = (p) => { const x = p.variants.map((v) => v.pricePoisha).filter((n) => n !== null); return x.length ? Math.min(...x) : null; };

// ── product photos ──
// No generated artwork. A product shows a real photo only if a file exists in demo/mock-api/media/:
//   <product-id>.jpg|jpeg|png|webp   (e.g. ds-01.jpg), or kind-<kind>.<ext> for a shared photo (e.g. kind-cup.jpg).
// Without a file the storefront shows its plain "photo coming soon" tile.
const MEDIA = new URL('./media/', import.meta.url);
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const photoOf = (p) => {
  for (const base of [p.slug, `kind-${p.kind}`]) for (const ext of Object.keys(MIME)) { if (existsSync(new URL(`${base}.${ext}`, MEDIA))) return `${base}.${ext}`; }
  return null;
};
const imgUrl = (p) => { const f = photoOf(p); return f ? `/v1/media/photos/${f}` : null; };

// ── storefront ──
const cardOf = (p) => ({
  id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, categorySlug: p.categorySlug,
  image: imgUrl(p) ? { url: imgUrl(p), altBn: p.nameBn } : null,
  outerCityStatus: p.outerCityStatus,
  fromPricePoisha: minPrice(p),
  inStock: p.variants.some((v) => avail(v) === 'IN_STOCK'),
  variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v) })),
});
function list(q) {
  let r = [...products];
  if (q.category) r = r.filter((p) => p.categorySlug === q.category);
  const col = collections.find((c) => c.slug === q.collection);
  if (q.collection) r = col ? r.filter((p) => col.slugs.includes(p.slug)) : [];
  if (q.q) { const t = q.q.toLowerCase(); r = r.filter((p) => p.nameBn.toLowerCase().includes(t) || p.nameEn.toLowerCase().includes(t)); }
  if (q.inStock === 'true') r = r.filter((p) => p.variants.some((v) => avail(v) === 'IN_STOCK'));
  const price = (p) => minPrice(p) ?? Number.MAX_SAFE_INTEGER; // unknown prices sort last
  if (q.sort === 'price_asc') r.sort((a, b) => price(a) - price(b));
  else if (q.sort === 'price_desc') r.sort((a, b) => price(b) - price(a));
  else if (q.sort === 'newest') r.sort((a, b) => b.createdOrder - a.createdOrder);
  const limit = Math.min(48, Math.max(1, Number(q.limit) || 24)), page = Math.max(1, Number(q.page) || 1);
  return { data: r.slice((page - 1) * limit, page * limit).map(cardOf), page, limit, total: r.length, areaChecked: Boolean(q.areaId) };
}
function detail(p, areaChecked) {
  return {
    id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, outerCityStatus: p.outerCityStatus,
    category: { slug: p.category.slug, nameBn: p.category.nameBn, nameEn: p.category.nameEn },
    images: imgUrl(p) ? [{ url: imgUrl(p), altBn: p.nameBn, altEn: p.nameEn, width: 800, height: 800 }] : [],
    content: { descriptionBn: p.descriptionBn, descriptionEn: null },
    variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v), maxQty: v.maxQty })),
    areaChecked,
  };
}
function cartView(c) {
  const lines = [...c.lines].map(([id, quantity]) => {
    const { p, v } = variants.get(id);
    return { variantId: id, productSlug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, labelBn: v.labelBn, image: imgUrl(p), unitPricePoisha: v.pricePoisha, quantity, lineTotalPoisha: v.pricePoisha === null ? null : v.pricePoisha * quantity, available: avail(v) === 'IN_STOCK', outerCityStatus: p.outerCityStatus, categorySlug: p.categorySlug, maxQty: v.maxQty };
  });
  return { id: c.id, areaId: c.areaId, couponCode: null, lines, subtotalPoisha: lines.some((l) => l.lineTotalPoisha === null) ? null : lines.reduce((s, l) => s + (l.lineTotalPoisha ?? 0), 0), itemCount: lines.reduce((s, l) => s + l.quantity, 0), warnings: [], areaChecked: Boolean(c.areaId) };
}

// ── admin (read-only demo) ──
const adminMe = { user: { id: '00000000-0000-4000-8000-000000000001', fullName: 'ডেমো সুপার অ্যাডমিন', email: DEMO_ADMIN.login, phone: null, mfaEnabled: true }, role: 'SUPER_ADMIN', outletId: null, mfaVerified: true };
// No stock data exists yet, so the admin stock list is intentionally empty rather than invented.
const inv = () => [];
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
    if ((mm = path.match(/^\/media\/photos\/([a-z0-9-]+)\.(jpg|jpeg|png|webp)$/))) {
      const f = new URL(`${mm[1]}.${mm[2]}`, MEDIA);
      if (!existsSync(f)) return err(res, 404, 'NOT_FOUND', 'Not found');
      res.writeHead(200, { 'content-type': MIME[mm[2]], 'cache-control': 'public, max-age=3600' });
      return res.end(readFileSync(f));
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
    if (m === 'GET' && path === '/outlets') return send(res, 200, outlets.map(({ id, code, nameBn, nameEn, addressLine }) => ({ id, code, nameBn, nameEn, addressLine })));
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
