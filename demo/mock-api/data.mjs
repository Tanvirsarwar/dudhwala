// DEMO DATA ONLY. Invented sample catalogue for a local client presentation: not real Dudhwala products, prices or stock.
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const categories = [
  { id: U(1), slug: 'milk', nameBn: 'দুধ', nameEn: 'Milk' },
  { id: U(2), slug: 'curd', nameBn: 'দই / ইয়োগার্ট', nameEn: 'Curd / Yogurt' },
  { id: U(3), slug: 'ghee-butter', nameBn: 'ঘি ও মাখন', nameEn: 'Ghee & Butter' },
  { id: U(4), slug: 'sweets', nameBn: 'মিষ্টি', nameEn: 'Sweets' },
  { id: U(5), slug: 'cheese', nameBn: 'পনির', nameEn: 'Paneer & Cheese' },
  { id: U(6), slug: 'bakery', nameBn: 'বেকারি', nameEn: 'Bakery' },
  { id: U(7), slug: 'snacks', nameBn: 'চানাচুর ও স্ন্যাকস', nameEn: 'Chanachur & Snacks' },
  { id: U(8), slug: 'gur', nameBn: 'গুড় ও মিষ্টিকারক', nameEn: 'Gur & Sweeteners' },
  { id: U(9), slug: 'biscuits', nameBn: 'বিস্কুট ও কুকিজ', nameEn: 'Biscuits & Cookies' },
  { id: U(10), slug: 'grocery', nameBn: 'অন্যান্য মুদি পণ্য', nameEn: 'Other Grocery' },
].map((c) => ({ ...c, parentId: null, active: true, sortOrder: 0 }));

// kind drives the generated illustration; v = [label, price in taka, optional compare-at in taka, stock]
const P = [
  ['fresh-milk', 'milk', 'bottle', 'খাঁটি তরল দুধ', 'Fresh Milk', [['৫০০ মিলি', 55, 0, 40], ['১ লিটার', 105, 0, 60]]],
  ['full-cream-milk', 'milk', 'bottle', 'ফুল ক্রিম দুধ', 'Full Cream Milk', [['১ লিটার', 130, 0, 35]]],
  ['flavoured-milk', 'milk', 'bottle', 'চকলেট ফ্লেভার্ড মিল্ক', 'Chocolate Flavoured Milk', [['২০০ মিলি', 40, 0, 50]]],
  ['sweet-curd', 'curd', 'cup', 'মিষ্টি দই', 'Sweet Curd (Mishti Doi)', [['৫০০ গ্রাম', 180, 0, 25], ['১ কেজি', 340, 380, 18]]],
  ['plain-curd', 'curd', 'cup', 'টক দই', 'Plain Curd', [['৫০০ গ্রাম', 120, 0, 30], ['১ কেজি', 230, 0, 22]]],
  ['borhani', 'curd', 'bottle', 'বোরহানি', 'Borhani', [['৫০০ মিলি', 90, 0, 0]]],
  ['pure-ghee', 'ghee-butter', 'jar', 'খাঁটি ঘি', 'Pure Ghee', [['২৫০ গ্রাম', 320, 0, 20], ['৫০০ গ্রাম', 620, 680, 15]]],
  ['butter', 'ghee-butter', 'block', 'সল্টেড বাটার', 'Salted Butter', [['১০০ গ্রাম', 110, 0, 28]]],
  ['rasgulla', 'sweets', 'sweet', 'রসগোল্লা', 'Rasgulla', [['৬ পিস', 150, 0, 24], ['১২ পিস', 290, 0, 16]]],
  ['chomchom', 'sweets', 'sweet', 'চমচম', 'Chomchom', [['৪ পিস', 160, 0, 20]]],
  ['sandesh', 'sweets', 'sweet', 'সন্দেশ', 'Sandesh', [['৫০০ গ্রাম', 480, 520, 12]]],
  ['rosh-malai', 'sweets', 'sweet', 'রসমালাই', 'Rosh Malai', [['৪ পিস', 220, 0, 14]]],
  ['paneer', 'cheese', 'block', 'তাজা পনির', 'Fresh Paneer', [['২০০ গ্রাম', 170, 0, 26]]],
  ['mozzarella', 'cheese', 'block', 'মোজারেলা চিজ', 'Mozzarella', [['২০০ গ্রাম', 330, 0, 10]]],
  ['milk-bread', 'bakery', 'loaf', 'মিল্ক ব্রেড', 'Milk Bread', [['৪০০ গ্রাম', 70, 0, 45]]],
  ['cream-bun', 'bakery', 'loaf', 'ক্রিম বান', 'Cream Bun', [['২ পিস', 60, 0, 30]]],
  ['rusk', 'bakery', 'loaf', 'দুধের রাস্ক', 'Milk Rusk', [['২৫০ গ্রাম', 95, 0, 38]]],
  ['cake-slice', 'bakery', 'loaf', 'ভ্যানিলা কেক', 'Vanilla Cake', [['৫০০ গ্রাম', 450, 0, 8]]],
  ['chanachur', 'snacks', 'pouch', 'চানাচুর', 'Chanachur', [['২০০ গ্রাম', 85, 0, 40], ['৫০০ গ্রাম', 190, 210, 25]]],
  ['dalmoth', 'snacks', 'pouch', 'ডালমুট', 'Dalmoth', [['২০০ গ্রাম', 95, 0, 30]]],
  ['jhal-muri-mix', 'snacks', 'pouch', 'ঝাল মুড়ি মিক্স', 'Jhal Muri Mix', [['১৫০ গ্রাম', 70, 0, 0]]],
  ['khejur-gur', 'gur', 'jar', 'খেজুর গুড়', 'Khejur Gur (Date-Palm Jaggery)', [['৫০০ গ্রাম', 260, 0, 18], ['১ কেজি', 500, 540, 12]]],
  ['patali-gur', 'gur', 'block', 'পাটালি গুড়', 'Patali Gur', [['৫০০ গ্রাম', 300, 0, 14]]],
  ['cane-jaggery', 'gur', 'block', 'আখের গুড়', 'Cane Jaggery', [['১ কেজি', 190, 0, 22]]],
  ['milk-biscuit', 'biscuits', 'cookie', 'মিল্ক বিস্কুট', 'Milk Biscuit', [['২০০ গ্রাম', 60, 0, 50]]],
  ['butter-cookies', 'biscuits', 'cookie', 'বাটার কুকিজ', 'Butter Cookies', [['২৫০ গ্রাম', 140, 160, 26]]],
  ['coconut-biscuit', 'biscuits', 'cookie', 'নারকেল বিস্কুট', 'Coconut Biscuit', [['২০০ গ্রাম', 75, 0, 34]]],
  ['masoor-dal', 'grocery', 'sack', 'মসুর ডাল', 'Masoor Dal', [['১ কেজি', 140, 0, 40]]],
  ['mustard-oil', 'grocery', 'bottle', 'সরিষার তেল', 'Mustard Oil', [['১ লিটার', 260, 0, 20]]],
  ['basmati-rice', 'grocery', 'sack', 'বাসমতি চাল', 'Basmati Rice', [['১ কেজি', 170, 0, 36], ['৫ কেজি', 800, 850, 15]]],
];

const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c]));
export const products = P.map(([slug, cat, kind, nameBn, nameEn, vs], i) => ({
  id: U(100 + i),
  slug,
  kind,
  categorySlug: cat,
  nameBn,
  nameEn,
  createdOrder: i,
  descriptionBn: `${nameBn} — ডেমো নমুনা তথ্য। এটি আসল দুধওয়ালা পণ্য, দাম বা স্টকের তথ্য নয়।`,
  variants: vs.map(([labelBn, taka, cmp, stock], j) => ({
    id: U(1000 + i * 10 + j),
    sku: `DEMO-${String(i + 1).padStart(3, '0')}-${j + 1}`,
    labelBn,
    labelEn: null,
    packSize: String(j + 1),
    packUnit: 'PCS',
    pricePoisha: taka * 100,
    compareAtPoisha: cmp ? cmp * 100 : null,
    status: 'ACTIVE',
    sortOrder: j,
    stock,
    maxQty: Math.min(stock, 20),
  })),
  category: catBySlug[cat],
}));

export const areas = ['জিন্দাবাজার', 'আম্বরখানা', 'উপশহর', 'সুবিদবাজার', 'শাহী ঈদগাহ', 'মীরবক্সটুলা'].map((n, i) => ({ id: U(500 + i), slug: `area-${i + 1}`, nameBn: n, nameEn: null }));

export const collections = [{ slug: 'todays-picks', titleBn: 'আজকের বিশেষ বাছাই', slugs: ['sweet-curd', 'pure-ghee', 'rasgulla', 'fresh-milk', 'sandesh', 'paneer', 'khejur-gur', 'chanachur'] }];

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
