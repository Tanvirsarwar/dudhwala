// Local demo data. Products come from catalogue.json (names only, from the supplied product lists); everything else here
// (areas, outlets, sample admin orders, pages) is demo data and not a real Dudhwala record.
import { readFileSync } from 'node:fs';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CATALOGUE = JSON.parse(readFileSync(new URL('./catalogue.json', import.meta.url), 'utf8'));

export const categories = CATALOGUE.categories.map((c, i) => ({ id: U(1 + i), ...c, parentId: null, active: true, sortOrder: i }));

const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
/**
 * Real catalogue (names only). Prices, pack sizes and stock are NOT in the supplied source, so they are null:
 * the UI shows "price to be confirmed" and never invents a value. `maxQty` is a DEMO cart cap, not stock.
 */
export const products = CATALOGUE.products.map((p, i) => ({
  id: U(100 + i),
  slug: p.id,
  kind: p.kind,
  categorySlug: p.category,
  nameBn: p.nameBn,
  nameEn: p.nameEn,
  nameVerified: p.nameVerified,
  outerCityStatus: p.outerCity ?? undefined,
  createdOrder: i,
  descriptionBn: null,
  variants: [{ id: U(1000 + i), sku: `DW-${p.id.toUpperCase()}`, labelBn: 'স্ট্যান্ডার্ড', labelEn: null, packSize: '1', packUnit: 'PCS', pricePoisha: null, compareAtPoisha: null, status: 'ACTIVE', sortOrder: 0, stock: null, maxQty: 20 }],
  category: catBySlug[p.category],
}));

export const areas = ['জিন্দাবাজার', 'আম্বরখানা', 'উপশহর', 'সুবিদবাজার', 'শাহী ঈদগাহ', 'মীরবক্সটুলা'].map((n, i) => ({ id: U(500 + i), slug: `area-${i + 1}`, nameBn: n, nameEn: null }));

export const collections = [];

export const pages = [
  { slug: 'about', titleBn: 'দুধওয়ালা সম্পর্কে', bodyBn: 'এটি স্থানীয় ক্লায়েন্ট ডেমোর নমুনা পাতা। আসল প্রতিষ্ঠানের গল্প ও তথ্য এখানে পরে বসবে।' },
  { slug: 'faq', titleBn: 'সাধারণ জিজ্ঞাসা', bodyBn: 'ডেমো: অর্ডার, ডেলিভারি ও পেমেন্ট সংক্রান্ত প্রশ্নের উত্তর এখানে থাকবে। এই ডেমোতে কোনো আসল অর্ডার নেওয়া হয় না।' },
  { slug: 'delivery-policy', titleBn: 'ডেলিভারি নীতি', bodyBn: 'ডেমো নমুনা: ডেলিভারি এলাকা, সময় ও ফি এখানে প্রদর্শিত হবে।' },
].map((p) => ({ ...p, updatedAt: '2026-01-01T00:00:00.000Z' }));

export const outlets = [
  { id: U(700), code: 'DEMO-SYL', nameBn: 'সিলেট সদর শাখা (ডেমো)', nameEn: 'Sylhet Sadar (demo)', addressLine: 'ডেমো ঠিকানা, সিলেট', phone: null, email: null, status: 'ACTIVE', acceptsOnlineOrders: true, autoConfirmOrders: false },
  { id: U(701), code: 'DEMO-UPS', nameBn: 'উপশহর শাখা (ডেমো)', nameEn: 'Upashahar (demo)', addressLine: 'ডেমো ঠিকানা, উপশহর', phone: null, email: null, status: 'ACTIVE', acceptsOnlineOrders: true, autoConfirmOrders: false },
];

const STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERED', 'CANCELLED'];
const NAMES = ['রহিম উদ্দিন', 'ফাতেমা বেগম', 'কামরুল হাসান', 'সুমাইয়া আক্তার', 'জাহিদ আলী', 'নাজমা খাতুন'];
export const orders = Array.from({ length: 16 }, (_, i) => {
  const o = outlets[i % 2];
  const status = STATUSES[i % STATUSES.length];
  const d = new Date(Date.UTC(2026, 0, 15, 4 + (i % 8), 0, 0));
  return {
    id: U(900 + i),
    orderNumber: `DEMO-${String(1001 + i)}`,
    status,
    paymentStatus: status === 'DELIVERED' ? 'PAID' : 'UNPAID',
    paymentMethod: 'COD',
    totalPoisha: (180 + ((i * 97) % 700)) * 100,
    slotStartsAt: d.toISOString(),
    slotEndsAt: new Date(d.getTime() + 2 * 3600e3).toISOString(),
    createdAt: new Date(d.getTime() - 20 * 3600e3).toISOString(),
    shipName: NAMES[i % NAMES.length],
    shipAreaNameBn: areas[i % areas.length].nameBn,
    outlet: { id: o.id, code: o.code },
    delivery: status === 'OUT_FOR_DELIVERY' ? { status: 'OUT_FOR_DELIVERY', riderUserId: null } : null,
    _count: { items: 1 + (i % 4) },
    late: i === 2,
  };
});
