// Local demo data. Products come from catalogue.json (names only, from the supplied product lists); everything else here
// (areas, outlets, sample admin orders, pages) is demo data and not a real Dudhwala record.
import { readFileSync } from 'node:fs';
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const CATALOGUE = JSON.parse(readFileSync(new URL('./catalogue.json', import.meta.url), 'utf8'));

/** Fresh seed state (called at first start and on "reset demo data"). Names only: no prices, sizes or stock are invented. */
export function seedState() {
  const categories = CATALOGUE.categories.map((c, i) => ({ id: U(1 + i), slug: c.slug, nameBn: c.nameBn, nameEn: c.nameEn, active: true, sortOrder: i }));
  /**
   * Real catalogue (names only). Prices, pack sizes and stock are NOT in the supplied source, so they are null:
   * the UI shows "price to be confirmed" and never invents a value. `maxQty` is a technical cart cap, not stock.
   */
  const products = CATALOGUE.products.map((p, i) => ({
    id: U(100 + i),
    slug: p.id,
    categorySlug: p.category,
    nameBn: p.nameBn,
    nameEn: p.nameEn,
    nameVerified: p.nameVerified,
    outerCityStatus: p.outerCity ?? null,
    active: true,
    createdOrder: i,
    content: { descriptionBn: null, ingredientsBn: null, allergensBn: null, storageBn: null, shelfLifeBn: null },
    variants: [{ id: U(1000 + i), labelBn: '', pricePoisha: null, compareAtPoisha: null, stock: null, maxQty: 999 }],
  }));
  return { categories, products, orders: [], orderSeq: 1000, config: structuredClone(DEFAULT_CONFIG) };
}

/** Editable from the admin Settings page. Bulk thresholds are placeholders until the shop approves real values. */
export const DEFAULT_CONFIG = {
  hours: { openMinute: 10 * 60, closeMinute: 22 * 60 },
  bulk: { minTotalQuantity: 20, minTotalPoisha: 2_000_000, isPlaceholder: true },
};

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

