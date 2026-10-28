// Dudhwala local DEMO API. Zero dependencies (Node >= 22). Product names come from the supplied product lists; prices,
// stock and photos are whatever the admin has entered. No database, payment gateway, SMS or network access.
// State is saved to demo/mock-api/runtime/store.json (see store.mjs). Admin edits take effect on the storefront at once.
import { createServer } from 'node:http';
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { areas, collections, pages, outlets } from './data.mjs';
import { state, save, resetState } from './store.mjs';

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);
const HOST = process.env.MOCK_API_HOST ?? '127.0.0.1';

// Demo staff accounts (local demo only; shown on the login pages). Real accounts come with the real backend.
const STAFF = [
  { login: 'admin@demo.local', password: 'demo1234', role: 'ADMIN', fullName: 'ডেমো অ্যাডমিন' },
  { login: 'manager@demo.local', password: 'manager1234', role: 'MANAGER', fullName: 'ডেমো ম্যানেজার' },
];
const sessions = new Map(); // token -> { role, login, fullName }

let shared = null;
try {
  shared = await import('../../packages/shared/dist/index.js');
} catch {
  /* shared package not built yet: the start script builds it first */
}

const MEDIA = process.env.MOCK_MEDIA_DIR ? pathToFileURL(`${process.env.MOCK_MEDIA_DIR.replace(/\/$/, '')}/`) : new URL('./media/', import.meta.url);
mkdirSync(MEDIA, { recursive: true });
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXTS = Object.keys(MIME);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const carts = new Map(); // cookie id -> { areaId, lines: Map<variantId, qty> }
const STATUS_FLOW = {
  HOME_DELIVERY: ['DEMO_PLACED', 'DEMO_PREPARING', 'DEMO_OUT_FOR_DELIVERY', 'DEMO_DELIVERED'],
  EXPRESS_PICKUP: ['DEMO_PICKUP_REQUESTED', 'DEMO_PREPARING', 'DEMO_READY_FOR_PICKUP', 'DEMO_PICKED_UP'],
  BULK_ORDER: ['DEMO_PREPAID_SIMULATED', 'DEMO_PREPARING', 'DEMO_READY_FOR_COLLECTION', 'DEMO_COLLECTED'],
};
const CANCELLED = 'DEMO_CANCELLED';
const OUTER_FLAGS = [null, 'approved', 'disabled', 'pending_verification', 'pending_confirmation'];

// ── lookups (rebuilt on every read: the data set is tiny) ──
const catOf = (slug) => state.categories.find((c) => c.slug === slug);
const variantIndex = () => new Map(state.products.flatMap((p) => p.variants.map((v) => [v.id, { p, v }])));
const avail = (v) => (v.stock === null || v.stock > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK');
const minPrice = (p) => { const x = p.variants.map((v) => v.pricePoisha).filter((n) => n !== null); return x.length ? Math.min(...x) : null; };

// ── product photos: demo/mock-api/media/<slug>.<ext>, uploaded from the admin product page ──
const photoFile = (p) => EXTS.map((e) => `${p.slug}.${e}`).find((f) => existsSync(new URL(f, MEDIA))) ?? null;
const imgUrl = (p) => { const f = photoFile(p); return f ? `/v1/media/photos/${f}?v=${Math.round(statSync(new URL(f, MEDIA)).mtimeMs)}` : null; };
const clearPhotos = (p) => { for (const e of EXTS) rmSync(new URL(`${p.slug}.${e}`, MEDIA), { force: true }); };
function sniff(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

// ── storefront views ──
const cardOf = (p) => ({
  id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, categorySlug: p.categorySlug,
  image: imgUrl(p) ? { url: imgUrl(p), altBn: p.nameBn } : null,
  outerCityStatus: p.outerCityStatus,
  fromPricePoisha: minPrice(p),
  inStock: p.variants.some((v) => avail(v) === 'IN_STOCK'),
  variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v) })),
});
const liveProducts = () => state.products.filter((p) => p.active && catOf(p.categorySlug)?.active !== false);
function list(q) {
  let r = liveProducts();
  if (q.category) r = r.filter((p) => p.categorySlug === q.category);
  if (q.collection) r = [];
  if (q.q) { const t = q.q.toLowerCase(); r = r.filter((p) => p.nameBn.toLowerCase().includes(t) || p.nameEn.toLowerCase().includes(t)); }
  if (q.inStock === 'true') r = r.filter((p) => p.variants.some((v) => avail(v) === 'IN_STOCK'));
  const price = (p) => minPrice(p) ?? Number.MAX_SAFE_INTEGER; // unknown prices sort last
  r = [...r];
  if (q.sort === 'price_asc') r.sort((a, b) => price(a) - price(b));
  else if (q.sort === 'price_desc') r.sort((a, b) => (minPrice(b) ?? -1) - (minPrice(a) ?? -1));
  else r.sort((a, b) => b.createdOrder - a.createdOrder);
  const limit = Math.min(48, Math.max(1, Number(q.limit) || 24)), page = Math.max(1, Number(q.page) || 1);
  return { data: r.slice((page - 1) * limit, page * limit).map(cardOf), page, limit, total: r.length, areaChecked: Boolean(q.areaId) };
}
function detail(p, areaChecked) {
  const c = catOf(p.categorySlug);
  return {
    id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, outerCityStatus: p.outerCityStatus,
    category: { slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn },
    images: imgUrl(p) ? [{ url: imgUrl(p), altBn: p.nameBn, altEn: p.nameEn, width: 800, height: 800 }] : [],
    content: Object.fromEntries(Object.entries(p.content).filter(([, v]) => v)),
    variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, labelEn: null, pricePoisha: v.pricePoisha, compareAtPoisha: v.compareAtPoisha, availability: avail(v), maxQty: v.maxQty })),
    areaChecked,
  };
}
function cartView(c) {
  const idx = variantIndex();
  const lines = [...c.lines].flatMap(([id, quantity]) => {
    const hit = idx.get(id);
    if (!hit || !hit.p.active) { c.lines.delete(id); return []; } // product removed or hidden by the admin since it was added
    const { p, v } = hit;
    return [{ variantId: id, productSlug: p.slug, categorySlug: p.categorySlug, outerCityStatus: p.outerCityStatus, nameBn: p.nameBn, nameEn: p.nameEn, labelBn: v.labelBn, image: imgUrl(p), unitPricePoisha: v.pricePoisha, quantity, lineTotalPoisha: v.pricePoisha === null ? null : v.pricePoisha * quantity, available: avail(v) === 'IN_STOCK' && (v.stock === null || quantity <= v.stock), maxQty: v.stock === null ? v.maxQty : Math.min(v.maxQty, v.stock) }];
  });
  return { id: c.id, areaId: c.areaId, couponCode: null, lines, subtotalPoisha: lines.some((l) => l.lineTotalPoisha === null) ? null : lines.reduce((s, l) => s + (l.lineTotalPoisha ?? 0), 0), itemCount: lines.reduce((s, l) => s + l.quantity, 0), warnings: [] };
}

// ── input helpers ──
class Bad extends Error { constructor(msg, code = 'VALIDATION_FAILED', status = 400) { super(msg); this.code = code; this.status = status; } }
const text = (v, max, { required = false, label = 'text' } = {}) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') { if (required) throw new Bad(`${label} is required`); return null; }
  if (typeof v !== 'string') throw new Bad(`${label} must be text`);
  const t = v.trim();
  if (!t && required) throw new Bad(`${label} is required`);
  if (t.length > max) throw new Bad(`${label} is too long (max ${max})`);
  return t || null;
};
const intOrNull = (v, label, { min = 0, max = 1_000_000_000 } = {}) => {
  if (v === null || v === '' || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Bad(`${label} must be a whole number between ${min} and ${max}`);
  return n;
};

// ── admin views ──
const adminProduct = (p) => {
  const c = catOf(p.categorySlug);
  return { id: p.id, slug: p.slug, nameBn: p.nameBn, nameEn: p.nameEn, categorySlug: p.categorySlug, categoryNameBn: c?.nameBn ?? '', active: p.active, nameVerified: p.nameVerified, outerCityStatus: p.outerCityStatus, image: imgUrl(p), content: p.content, variants: p.variants, createdOrder: p.createdOrder };
};
const dhakaDay = (d) => new Date(new Date(d).getTime() + 6 * 3600e3).toISOString().slice(0, 10);
function summary() {
  const ps = state.products;
  const open = (o) => ![STATUS_FLOW[o.method].at(-1), CANCELLED].includes(o.status);
  const today = dhakaDay(Date.now());
  const by = (key) => state.orders.reduce((m, o) => ((m[o[key]] = (m[o[key]] ?? 0) + 1), m), {});
  const priced = state.orders.filter((o) => o.status !== CANCELLED && o.totalPoisha !== null);
  return {
    products: {
      total: ps.length, active: ps.filter((p) => p.active).length, hidden: ps.filter((p) => !p.active).length,
      noPrice: ps.filter((p) => p.variants.some((v) => v.pricePoisha === null)).length,
      noImage: ps.filter((p) => !photoFile(p)).length,
      outOfStock: ps.filter((p) => p.variants.every((v) => avail(v) === 'OUT_OF_STOCK')).length,
      byCategory: state.categories.map((c) => ({ slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn, count: ps.filter((p) => p.categorySlug === c.slug).length, active: ps.filter((p) => p.categorySlug === c.slug && p.active).length })),
    },
    orders: {
      total: state.orders.length, today: state.orders.filter((o) => dhakaDay(o.createdAt) === today).length, open: state.orders.filter(open).length,
      byStatus: by('status'), byMethod: by('method'), itemsOrdered: state.orders.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.quantity, 0), 0),
      knownRevenuePoisha: priced.reduce((s, o) => s + o.totalPoisha, 0), ordersWithUnknownPrice: state.orders.filter((o) => o.totalPoisha === null).length,
      latest: state.orders.slice(0, 5).map(orderRow),
    },
  };
}
const orderRow = (o) => ({ id: o.id, createdAt: o.createdAt, method: o.method, zone: o.zone, status: o.status, totalPoisha: o.totalPoisha, itemCount: o.lines.reduce((s, l) => s + l.quantity, 0), customer: (o.address ?? o.contact)?.name ?? null, outletNameBn: o.outlet?.nameBn ?? null });
const publicOrder = (o) => ({ id: o.id, status: o.status, method: o.method });
/** What staff see: everything except the customer's private lookup token. */
const staffOrder = ({ token, ...o }) => o;
/** What the customer who placed the order sees (needs the token returned at creation). */
const customerOrder = ({ token, history, ...o }) => ({ ...o, history: history.map(({ status, at }) => ({ status, at })) });

// ── orders ──
function buildOrder(b) {
  if (!['HOME_DELIVERY', 'EXPRESS_PICKUP', 'BULK_ORDER'].includes(b.method)) throw new Bad('Unknown fulfilment method');
  const zone = b.zone === 'OUTER_CITY' ? 'OUTER_CITY' : b.zone === 'IN_CITY' ? 'IN_CITY' : null;
  if (!Array.isArray(b.lines) || b.lines.length === 0 || b.lines.length > 100) throw new Bad('The order needs 1-100 lines');
  const idx = variantIndex();
  const lines = b.lines.map((l) => {
    const hit = idx.get(l?.variantId);
    const qty = Number(l?.quantity);
    if (!hit || !hit.p.active) throw new Bad('A product in the order is no longer available', 'PRODUCT_UNAVAILABLE', 409);
    if (!Number.isInteger(qty) || qty < 1 || qty > hit.v.maxQty) throw new Bad('Invalid quantity');
    if (hit.v.stock !== null && qty > hit.v.stock) throw new Bad('Not enough stock', 'OUT_OF_STOCK', 409);
    return { key: hit.v.id, productSlug: hit.p.slug, categorySlug: hit.p.categorySlug, outerCityStatus: hit.p.outerCityStatus, nameBn: hit.p.nameBn, nameEn: hit.p.nameEn, quantity: qty, unitPricePoisha: hit.v.pricePoisha, linePoisha: hit.v.pricePoisha === null ? null : hit.v.pricePoisha * qty };
  });
  // Server-side copies of the storefront rules (zone eligibility, bulk classification). Ordering hours are checked by the
  // storefront only in this demo, so the demo can be shown at any time of day.
  if (shared) {
    const bulk = shared.bulkStatus(lines.map((l) => ({ quantity: l.quantity, linePoisha: l.linePoisha })), state.config.bulk);
    if (bulk.isBulk && b.method !== 'BULK_ORDER') throw new Bad('This cart qualifies as a bulk order', 'BULK_REQUIRED', 422);
    if (!bulk.isBulk && b.method === 'BULK_ORDER') throw new Bad('Not enough items for a bulk order', 'NOT_BULK', 422);
    if (b.method === 'HOME_DELIVERY') {
      if (!zone) throw new Bad('Choose a delivery zone', 'ZONE_REQUIRED', 422);
      const bad = lines.find((l) => !shared.zoneEligibility({ categorySlug: l.categorySlug, outerCityStatus: l.outerCityStatus }, zone).eligible);
      if (bad) throw new Bad(`${bad.nameBn} cannot be delivered to this zone`, 'NOT_DELIVERABLE', 422);
    }
  }
  const o = { id: `DEMO-${++state.orderSeq}`, demo: true, createdAt: new Date().toISOString(), method: b.method, zone: b.method === 'HOME_DELIVERY' ? zone : null, status: STATUS_FLOW[b.method][0], lines: lines.map(({ categorySlug, outerCityStatus, ...l }) => l), totalPoisha: lines.some((l) => l.linePoisha === null) ? null : lines.reduce((s, l) => s + l.linePoisha, 0), payment: 'NOT_REQUIRED_DEMO', history: [], token: randomBytes(16).toString('hex') };
  const a = b.method === 'HOME_DELIVERY' ? b.address ?? {} : b.contact ?? {};
  const name = text(a.name, 80, { required: true, label: 'name' });
  const phone = text(a.phone, 20, { required: true, label: 'phone' });
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(phone.replace(/[\s-]/g, ''))) throw new Bad('Invalid mobile number');
  if (b.method === 'HOME_DELIVERY') {
    o.address = { name, phone, line1: text(a.line1, 300, { required: true, label: 'address' }), landmark: text(a.landmark, 120) ?? '' };
    o.etaZone = zone ?? 'IN_CITY';
  } else {
    o.contact = { name, phone };
    if (b.method === 'EXPRESS_PICKUP') {
      const out = outlets.find((x) => x.id === b.outletId);
      if (!out) throw new Bad('Choose a pickup outlet');
      const at = new Date(b.pickupAt);
      if (Number.isNaN(at.getTime())) throw new Bad('Invalid pickup time');
      o.outlet = { id: out.id, nameBn: out.nameBn, nameEn: out.nameEn };
      o.pickupAt = at.toISOString();
    } else {
      o.outlet = { id: null, nameBn: 'মদিনা মার্কেট শাখা', nameEn: 'Modina Market Branch' };
      if (b.payment !== 'DEMO_PAID_SIMULATED') throw new Bad('Bulk orders need the (simulated) prepayment first', 'PREPAYMENT_REQUIRED', 422);
      o.payment = 'DEMO_PAID_SIMULATED';
    }
  }
  o.history.push({ status: o.status, at: o.createdAt, by: 'customer' });
  return o;
}

// ── http plumbing ──
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-demo-mode': 'true', ...headers });
  res.end(status === 204 ? undefined : JSON.stringify(body));
};
const err = (res, status, code, message) => send(res, status, { error: { code, message, requestId: 'demo' } });
const cookies = (req) => Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((c) => [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)]));
const body = (req, limit = 8 * 1024 * 1024) => new Promise((ok, fail) => {
  let s = '', big = false;
  req.on('data', (d) => {
    if (big) return; // keep draining so the client can read our 413 instead of a reset connection
    s += d;
    if (s.length > limit) { big = true; s = ''; }
  });
  req.on('end', () => {
    if (big) return fail(new Bad('Request too large', 'TOO_LARGE', 413));
    try { ok(JSON.parse(s || '{}')); } catch { fail(new Bad('Invalid JSON')); }
  });
});
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/v1/, '') || '/';
  const q = Object.fromEntries(url.searchParams);
  const ck = cookies(req);
  const m = req.method;
  const sess = sessions.get(ck.dw_staff_sid) ?? null;
  try {
    if (m === 'OPTIONS') return send(res, 204, null);
    if (path === '/health/ready' || path === '/health/live') return send(res, 200, { status: 'ok', demo: true });
    if (path === '/auth/csrf') return send(res, 200, { csrfToken: 'demo-token' });
    let mm;
    if ((mm = path.match(/^\/media\/photos\/([a-z0-9-]+)\.(jpg|jpeg|png|webp)$/))) {
      const f = new URL(`${mm[1]}.${mm[2]}`, MEDIA);
      if (!existsSync(f)) return err(res, 404, 'NOT_FOUND', 'Not found');
      res.writeHead(200, { 'content-type': MIME[mm[2]], 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      return res.end(readFileSync(f));
    }

    // ── storefront reads ──
    if (m === 'GET' && path === '/catalog/categories') return send(res, 200, [...state.categories].filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder).map(({ active, sortOrder, ...c }) => c));
    if (m === 'GET' && path === '/catalog/products') return send(res, 200, list(q));
    if (m === 'GET' && (mm = path.match(/^\/catalog\/products\/([a-z0-9-]+)$/))) {
      const p = state.products.find((x) => x.slug === mm[1] && x.active);
      return p ? send(res, 200, detail(p, Boolean(q.areaId))) : err(res, 404, 'NOT_FOUND', 'পণ্য পাওয়া যায়নি');
    }
    if (m === 'GET' && path === '/config') return send(res, 200, state.config);
    if (m === 'GET' && path === '/content/home') return send(res, 200, { banners: [], collections: collections.map(({ slug, titleBn }) => ({ slug, titleBn })), pages: pages.map(({ slug, titleBn }) => ({ slug, titleBn })), maintenance: false });
    if (m === 'GET' && (mm = path.match(/^\/content\/pages\/([a-z-]+)$/))) {
      const pg = pages.find((x) => x.slug === mm[1]);
      return pg ? send(res, 200, pg) : err(res, 404, 'NOT_FOUND', 'পাতা পাওয়া যায়নি');
    }
    if (m === 'GET' && path === '/delivery/areas') return send(res, 200, areas);
    if (m === 'GET' && path === '/outlets') return send(res, 200, outlets.map(({ id, code, nameBn, nameEn, addressLine }) => ({ id, code, nameBn, nameEn, addressLine })));
    if (m === 'GET' && path === '/delivery/check') return send(res, 200, { serviceable: true });

    // ── cart ──
    if (path === '/cart' || path.startsWith('/cart/')) {
      let id = ck.dw_cart;
      if (!id || !carts.has(id)) { id = randomUUID(); carts.set(id, { id, areaId: null, lines: new Map() }); }
      const c = carts.get(id);
      const hdr = { 'set-cookie': `dw_cart=${id}; Path=/; HttpOnly; SameSite=Lax` };
      if (m === 'GET' && path === '/cart') return send(res, 200, cartView(c), hdr);
      if (m === 'PUT' && (mm = path.match(/^\/cart\/items\/([0-9a-f-]{36})$/))) {
        const hit = variantIndex().get(mm[1]);
        if (!hit || !hit.p.active) return err(res, 404, 'NOT_FOUND', 'পণ্য পাওয়া যায়নি');
        const qty = Number((await body(req)).quantity);
        if (!Number.isInteger(qty) || qty < 0) return err(res, 400, 'VALIDATION_FAILED', 'সংখ্যা সঠিক নয়');
        const cap = hit.v.stock === null ? hit.v.maxQty : Math.min(hit.v.maxQty, hit.v.stock);
        if (qty > cap) return err(res, 409, 'CONFLICT', `সর্বোচ্চ ${cap}টি নেওয়া যাবে`);
        if (qty === 0) c.lines.delete(mm[1]); else c.lines.set(mm[1], qty);
        return send(res, 200, cartView(c), hdr);
      }
      if (m === 'PUT' && path === '/cart/area') { c.areaId = (await body(req)).areaId ?? null; return send(res, 200, cartView(c), hdr); }
    }

    // ── customer orders (no login in the demo; the order id is the only handle) ──
    if (m === 'POST' && path === '/orders') {
      const o = buildOrder(await body(req));
      state.orders.unshift(o);
      save();
      return send(res, 201, o);
    }
    if (m === 'GET' && (mm = path.match(/^\/orders\/(DEMO-\d+)$/))) {
      const o = state.orders.find((x) => x.id === mm[1]);
      const t = String(req.headers['x-order-token'] ?? '');
      // same answer for "no such order" and "wrong token": ids are guessable, tokens are not
      if (!o || !t || !same(o.token, t)) return err(res, 404, 'NOT_FOUND', 'Not found');
      return send(res, 200, customerOrder(o));
    }
    if (m === 'GET' && (mm = path.match(/^\/orders\/(DEMO-\d+)\/status$/))) {
      const o = state.orders.find((x) => x.id === mm[1]);
      return o ? send(res, 200, publicOrder(o)) : err(res, 404, 'NOT_FOUND', 'Not found');
    }

    // ── staff sign-in ──
    if (m === 'POST' && path === '/auth/staff/login') {
      const b = await body(req);
      const want = b.as === 'manager' ? 'MANAGER' : 'ADMIN';
      const u = STAFF.find((s) => s.login === String(b.login ?? '').trim().toLowerCase());
      // same message for every failure; the role must match the login page used
      if (!u || u.role !== want || !same(u.password, String(b.password ?? ''))) return err(res, 401, 'UNAUTHENTICATED', 'ইমেইল বা পাসওয়ার্ড সঠিক নয়');
      const token = randomBytes(24).toString('hex');
      sessions.set(token, { role: u.role, login: u.login, fullName: u.fullName });
      return send(res, 200, { role: u.role }, { 'set-cookie': `dw_staff_sid=${token}; Path=/; HttpOnly; SameSite=Strict` });
    }
    if (m === 'POST' && path === '/auth/logout') { sessions.delete(ck.dw_staff_sid); return send(res, 204, null, { 'set-cookie': 'dw_staff_sid=; Path=/; Max-Age=0' }); }
    if (path === '/me') return sess ? send(res, 200, { user: { fullName: sess.fullName, email: sess.login }, role: sess.role, canEdit: sess.role === 'ADMIN' }) : err(res, 401, 'UNAUTHENTICATED', 'লগইন করা নেই');

    // ── staff area ──
    if (path.startsWith('/admin/')) {
      if (!sess) return err(res, 401, 'UNAUTHENTICATED', 'লগইন করা নেই');
      const write = m !== 'GET';
      if (write && sess.role !== 'ADMIN') return err(res, 403, 'READ_ONLY', 'ম্যানেজার অ্যাকাউন্টে পরিবর্তন করা যায় না (শুধু দেখা)।');
      if (write && !req.headers['x-csrf-token']) return err(res, 403, 'FORBIDDEN', 'Missing CSRF token');

      if (m === 'GET' && path === '/admin/summary') return send(res, 200, summary());
      if (m === 'GET' && path === '/admin/config') return send(res, 200, state.config);
      if (m === 'PUT' && path === '/admin/config') {
        const b = await body(req);
        const open = shared?.hhmmToMinutes(String(b.hours?.open ?? '')), close = shared?.hhmmToMinutes(String(b.hours?.close ?? ''));
        if (open == null || close == null || open >= close) throw new Bad('Opening time must be before closing time (HH:MM)');
        const minQty = intOrNull(b.bulk?.minTotalQuantity, 'Bulk quantity', { min: 1, max: 100000 });
        const minTaka = intOrNull(b.bulk?.minTotalTaka, 'Bulk amount', { min: 1, max: 100_000_000 });
        if (minQty === null || minTaka === null) throw new Bad('Bulk thresholds are required');
        state.config = { hours: { openMinute: open, closeMinute: close }, bulk: { minTotalQuantity: minQty, minTotalPoisha: minTaka * 100, isPlaceholder: false } };
        save();
        return send(res, 200, state.config);
      }
      if (m === 'POST' && path === '/admin/reset') { resetState(); save(); return send(res, 200, { ok: true }); }

      // categories
      if (m === 'GET' && path === '/admin/categories') return send(res, 200, [...state.categories].sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ ...c, productCount: state.products.filter((p) => p.categorySlug === c.slug).length })));
      if (m === 'POST' && path === '/admin/categories') {
        const b = await body(req);
        const nameBn = text(b.nameBn, 60, { required: true, label: 'Bangla name' }), nameEn = text(b.nameEn, 60, { required: true, label: 'English name' });
        const slug = `c-${randomBytes(3).toString('hex')}`;
        const c = { id: randomUUID(), slug, nameBn, nameEn, active: true, sortOrder: Math.max(-1, ...state.categories.map((x) => x.sortOrder)) + 1 };
        state.categories.push(c); save();
        return send(res, 201, c);
      }
      if (m === 'PATCH' && (mm = path.match(/^\/admin\/categories\/([0-9a-f-]{36})$/))) {
        const c = state.categories.find((x) => x.id === mm[1]);
        if (!c) return err(res, 404, 'NOT_FOUND', 'Not found');
        const b = await body(req);
        const nb = text(b.nameBn, 60, { required: true, label: 'Bangla name' }), ne = text(b.nameEn, 60, { required: true, label: 'English name' });
        if (nb !== undefined) c.nameBn = nb;
        if (ne !== undefined) c.nameEn = ne;
        if (typeof b.active === 'boolean') c.active = b.active;
        if (b.sortOrder !== undefined) c.sortOrder = intOrNull(b.sortOrder, 'Order', { min: 0, max: 1000 }) ?? c.sortOrder;
        save();
        return send(res, 200, c);
      }

      // products
      if (m === 'GET' && path === '/admin/products') {
        let r = state.products;
        if (q.category) r = r.filter((p) => p.categorySlug === q.category);
        if (q.status === 'active') r = r.filter((p) => p.active);
        if (q.status === 'hidden') r = r.filter((p) => !p.active);
        if (q.status === 'noprice') r = r.filter((p) => p.variants.some((v) => v.pricePoisha === null));
        if (q.status === 'noimage') r = r.filter((p) => !photoFile(p));
        if (q.q) { const t = q.q.toLowerCase(); r = r.filter((p) => p.nameBn.toLowerCase().includes(t) || p.nameEn.toLowerCase().includes(t) || p.slug.includes(t)); }
        return send(res, 200, { data: r.map(adminProduct), total: r.length });
      }
      if (m === 'GET' && (mm = path.match(/^\/admin\/products\/([0-9a-f-]{36})$/))) {
        const p = state.products.find((x) => x.id === mm[1]);
        return p ? send(res, 200, adminProduct(p)) : err(res, 404, 'NOT_FOUND', 'Not found');
      }
      if (m === 'POST' && path === '/admin/products') {
        const b = await body(req);
        const nameBn = text(b.nameBn, 120, { required: true, label: 'Bangla name' }), nameEn = text(b.nameEn, 120, { required: true, label: 'English name' });
        if (!catOf(b.categorySlug)) throw new Bad('Choose a category');
        const n = Math.max(0, ...state.products.map((x) => x.createdOrder)) + 1;
        const p = { id: randomUUID(), slug: `p-${n.toString(36)}-${randomBytes(2).toString('hex')}`, categorySlug: b.categorySlug, nameBn, nameEn, nameVerified: true, outerCityStatus: null, active: true, createdOrder: n, content: { descriptionBn: null, ingredientsBn: null, allergensBn: null, storageBn: null, shelfLifeBn: null }, variants: [{ id: randomUUID(), labelBn: '', pricePoisha: null, compareAtPoisha: null, stock: null, maxQty: 999 }] };
        state.products.push(p); save();
        return send(res, 201, adminProduct(p));
      }
      if ((mm = path.match(/^\/admin\/products\/([0-9a-f-]{36})$/)) && m === 'PATCH') {
        const p = state.products.find((x) => x.id === mm[1]);
        if (!p) return err(res, 404, 'NOT_FOUND', 'Not found');
        const b = await body(req);
        const next = structuredClone(p);
        const nb = text(b.nameBn, 120, { required: true, label: 'Bangla name' }); if (nb !== undefined) next.nameBn = nb;
        const ne = text(b.nameEn, 120, { required: true, label: 'English name' }); if (ne !== undefined) next.nameEn = ne;
        if (b.categorySlug !== undefined) { if (!catOf(b.categorySlug)) throw new Bad('Unknown category'); next.categorySlug = b.categorySlug; }
        if (typeof b.active === 'boolean') next.active = b.active;
        if (typeof b.nameVerified === 'boolean') next.nameVerified = b.nameVerified;
        if (b.outerCityStatus !== undefined) { if (!OUTER_FLAGS.includes(b.outerCityStatus)) throw new Bad('Unknown Outer City setting'); next.outerCityStatus = b.outerCityStatus; }
        if (b.content && typeof b.content === 'object') for (const k of Object.keys(next.content)) if (k in b.content) next.content[k] = text(b.content[k], 2000, { label: k }) ?? null;
        if (b.variants !== undefined) {
          if (!Array.isArray(b.variants) || b.variants.length < 1 || b.variants.length > 20) throw new Bad('A product needs 1-20 sizes/options');
          const have = new Set(p.variants.map((v) => v.id));
          next.variants = b.variants.map((v) => {
            const price = intOrNull(v.pricePoisha, 'Price'), cmp = intOrNull(v.compareAtPoisha, 'Old price');
            if (cmp !== null && (price === null || cmp <= price)) throw new Bad('Old price must be higher than the price');
            return { id: have.has(v.id) ? v.id : randomUUID(), labelBn: text(v.labelBn, 60) ?? '', pricePoisha: price, compareAtPoisha: cmp, stock: intOrNull(v.stock, 'Stock'), maxQty: intOrNull(v.maxQty, 'Max quantity', { min: 1, max: 9999 }) ?? 999 };
          });
        }
        Object.assign(p, next); save();
        return send(res, 200, adminProduct(p));
      }
      if ((mm = path.match(/^\/admin\/products\/([0-9a-f-]{36})\/image$/))) {
        const p = state.products.find((x) => x.id === mm[1]);
        if (!p) return err(res, 404, 'NOT_FOUND', 'Not found');
        if (m === 'DELETE') { clearPhotos(p); return send(res, 200, adminProduct(p)); }
        if (m === 'POST') {
          const b = await body(req);
          const buf = Buffer.from(String(b.dataBase64 ?? ''), 'base64');
          if (buf.length === 0) throw new Bad('Choose an image file');
          if (buf.length > MAX_IMAGE_BYTES) throw new Bad('Image is too large (max 5 MB)', 'TOO_LARGE', 413);
          const ext = sniff(buf); // trust the file's own bytes, not the client-declared type or name
          if (!ext) throw new Bad('Only JPG, PNG or WebP images are allowed');
          clearPhotos(p);
          writeFileSync(new URL(`${p.slug}.${ext}`, MEDIA), buf);
          return send(res, 200, adminProduct(p));
        }
      }

      // orders
      if (m === 'GET' && path === '/admin/orders') {
        let r = state.orders;
        if (q.status) r = r.filter((o) => o.status === q.status);
        if (q.method) r = r.filter((o) => o.method === q.method);
        if (q.q) { const t = q.q.toLowerCase(); r = r.filter((o) => o.id.toLowerCase().includes(t) || ((o.address ?? o.contact)?.name ?? '').toLowerCase().includes(t) || ((o.address ?? o.contact)?.phone ?? '').includes(t)); }
        return send(res, 200, { data: r.map(orderRow), total: r.length });
      }
      if ((mm = path.match(/^\/admin\/orders\/(DEMO-\d+)$/))) {
        const o = state.orders.find((x) => x.id === mm[1]);
        if (!o) return err(res, 404, 'NOT_FOUND', 'Not found');
        if (m === 'GET') return send(res, 200, { ...staffOrder(o), flow: STATUS_FLOW[o.method] });
        if (m === 'PATCH') {
          const next = String((await body(req)).status ?? '');
          const flow = STATUS_FLOW[o.method];
          const from = flow.indexOf(o.status), to = flow.indexOf(next);
          const final = o.status === CANCELLED || from === flow.length - 1;
          if (final) throw new Bad('This order is already finished', 'INVALID_TRANSITION', 409);
          if (next !== CANCELLED && !(to > from)) throw new Bad('Choose a later step', 'INVALID_TRANSITION', 409);
          o.status = next; o.history.push({ status: next, at: new Date().toISOString(), by: sess.login });
          save();
          return send(res, 200, { ...staffOrder(o), flow });
        }
      }
      return err(res, 404, 'NOT_FOUND', 'Not found');
    }

    return err(res, 404, 'NOT_FOUND', 'এই ডেমোতে এটি নেই');
  } catch (e) {
    if (e instanceof Bad) return err(res, e.status, e.code, e.message);
    return err(res, 500, 'DEMO_ERROR', String(e?.message ?? e));
  }
}).listen(PORT, HOST, () => console.log(`Dudhwala DEMO API on http://${HOST}:${PORT}/v1 (state: demo/mock-api/runtime/store.json)`));
