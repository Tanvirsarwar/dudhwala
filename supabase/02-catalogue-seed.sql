-- Dudhwala: product catalogue (names and Outer Sylhet marks only; NO prices, sizes, stock or photos exist in the source).
-- Run AFTER 01-schema.sql. Idempotent: re-running adds nothing and never overwrites admin edits.
-- Products arrive HIDDEN (active=false) and unpriced; set price/stock/photo in the admin, then switch them on.
BEGIN;
INSERT INTO category (id, slug, name_bn, name_en, sort_order, active) VALUES (gen_random_uuid(), 'dairy-sweets', 'দুগ্ধজাত মিষ্টি', 'Dairy Sweets', 0, true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO category (id, slug, name_bn, name_en, sort_order, active) VALUES (gen_random_uuid(), 'doi-dairy', 'দই ও দুগ্ধজাত', 'Doi / Dairy', 1, true) ON CONFLICT (slug) DO NOTHING;
INSERT INTO category (id, slug, name_bn, name_en, sort_order, active) VALUES (gen_random_uuid(), 'bakery', 'বেকারি', 'Bakery', 2, true) ON CONFLICT (slug) DO NOTHING;

WITH new_products AS (
  INSERT INTO product (id, category_id, slug, name_bn, name_en, name_verified, outer_city_status, active, updated_at)
  SELECT gen_random_uuid(), c.id, v.slug, v.name_bn, v.name_en, v.verified, v.outer_status::"OuterCityStatus", false, now()
  FROM (VALUES
    ('ds-01', 'dairy-sweets', 'সাদা রসগোল্লা', 'White Rasgulla', true, NULL),
    ('ds-02', 'dairy-sweets', 'কালোজাম', 'Kalojam', true, NULL),
    ('ds-03', 'dairy-sweets', 'গোলাপজাম', 'Golapjam', true, NULL),
    ('ds-04', 'dairy-sweets', 'মতি লাড্ডু', 'Moti Laddu', false, 'PENDING_VERIFICATION'),
    ('ds-05', 'dairy-sweets', 'রসমালাই', 'Rosh Malai', true, NULL),
    ('ds-06', 'dairy-sweets', 'দুধরাজ', 'Dudhraj', true, NULL),
    ('ds-07', 'dairy-sweets', 'ক্ষীরমোহন', 'Kheer Mohan', true, NULL),
    ('ds-08', 'dairy-sweets', 'জাফরান ভোগ', 'Zafran Bhog', true, NULL),
    ('ds-09', 'dairy-sweets', 'মালাইচপ', 'Malai Chop', true, NULL),
    ('ds-10', 'dairy-sweets', 'কাঁচা সন্দেশ', 'Kacha Sandesh', true, NULL),
    ('ds-11', 'dairy-sweets', 'সরপোড়া সন্দেশ', 'Sarpora Sandesh', false, NULL),
    ('ds-12', 'dairy-sweets', 'দধিয়া সন্দেশ', 'Dadhiya Sandesh', false, NULL),
    ('ds-13', 'dairy-sweets', 'গুড়ের সন্দেশ', 'Gurer Sandesh', true, NULL),
    ('ds-14', 'dairy-sweets', 'বোন্দে সন্দেশ', 'Bonde Sandesh', false, NULL),
    ('ds-15', 'dairy-sweets', 'অরেঞ্জ সন্দেশ', 'Orange Sandesh', true, NULL),
    ('ds-16', 'dairy-sweets', 'সাদা চমচম', 'White Chomchom', true, NULL),
    ('ds-17', 'dairy-sweets', 'বাদামী চমচম', 'Brown Chomchom', true, NULL),
    ('ds-18', 'dairy-sweets', 'পাতা চমচম', 'Pata Chomchom', true, NULL),
    ('ds-19', 'dairy-sweets', 'কাশ্মীরী ভোগ', 'Kashmiri Bhog', true, NULL),
    ('ds-20', 'dairy-sweets', 'সরভোল', 'Sarbhol', false, NULL),
    ('ds-23', 'dairy-sweets', 'দুধ', 'Milk', true, NULL),
    ('ds-24', 'dairy-sweets', 'ঘি', 'Ghee', true, 'APPROVED'),
    ('ds-25', 'dairy-sweets', 'নিমকি', 'Nimki', true, 'APPROVED'),
    ('doi-01', 'doi-dairy', 'প্রিমিয়াম দই সরা', 'Premium Doi Shara', true, NULL),
    ('doi-02', 'doi-dairy', 'পাতিল দই', 'Patil Doi', true, NULL),
    ('doi-03', 'doi-dairy', 'বাটি দই', 'Bati Doi', true, 'APPROVED'),
    ('doi-04', 'doi-dairy', 'প্রিমিয়াম দই', 'Premium Doi', true, 'APPROVED'),
    ('doi-05', 'doi-dairy', 'টক দই', 'Tok Doi (Sour Curd)', true, NULL),
    ('doi-06', 'doi-dairy', 'প্রিমিয়াম কাপ দই', 'Premium Cup Doi', true, 'APPROVED'),
    ('doi-07', 'doi-dairy', 'কাপ দই', 'Cup Doi', true, 'APPROVED'),
    ('doi-08', 'doi-dairy', 'মাঠা ৫০০ গ্রাম', 'Matha 500 g', true, NULL),
    ('doi-09', 'doi-dairy', 'মাঠা ২৫০ গ্রাম', 'Matha 250 g', true, NULL),
    ('doi-10', 'doi-dairy', 'ঘোল ৫০০ গ্রাম', 'Ghol 500 g', true, NULL),
    ('doi-11', 'doi-dairy', 'ঘোল ২৫০ গ্রাম', 'Ghol 250 g', true, NULL),
    ('bk-badam-biscuit', 'bakery', 'বাদাম বিস্কুট', 'Badam Biscuit', true, NULL),
    ('bk-kaju-badam-biscuit', 'bakery', 'কাজু বাদাম বিস্কুট', 'Cashew Nut Biscuit', true, NULL),
    ('bk-coconut-biscuit', 'bakery', 'কোকোনাট বিস্কুট', 'Coconut Biscuit', true, NULL),
    ('bk-vanilla-biscuit', 'bakery', 'ভ্যানিলা বিস্কুট', 'Vanilla Biscuit', false, 'PENDING_VERIFICATION'),
    ('bk-salt-biscuit', 'bakery', 'সল্ট বিস্কুট', 'Salt Biscuit', false, 'PENDING_VERIFICATION'),
    ('bk-dry-cake', 'bakery', 'ড্রাই কেক', 'Dry Cake', false, 'PENDING_VERIFICATION'),
    ('bk-cha-toast', 'bakery', 'চা টোস্ট', 'Cha Toast', true, NULL),
    ('bk-charcoal', 'bakery', 'চারকোল', 'Charcoal', true, NULL),
    ('bk-sweet-cake', 'bakery', 'সুইট কেক', 'Sweet Cake', false, 'PENDING_VERIFICATION'),
    ('bk-fruit-cake', 'bakery', 'ফ্রুট কেক', 'Fruit Cake', true, NULL),
    ('bk-butter-toast', 'bakery', 'বাটার টোস্ট', 'Butter Toast', true, NULL),
    ('bk-badam-toast', 'bakery', 'বাদাম টোস্ট', 'Badam Toast', true, NULL),
    ('bk-bread-toast', 'bakery', 'ব্রেড টোস্ট', 'Bread Toast', true, NULL),
    ('bk-baby-toast', 'bakery', 'বেবি টোস্ট', 'Baby Toast', true, NULL),
    ('bk-badam-cake', 'bakery', 'বাদাম কেক', 'Badam Cake', true, NULL),
    ('bk-toast-cake', 'bakery', 'টোস্ট কেক', 'Toast Cake', true, NULL),
    ('bk-bos-cake', 'bakery', 'বোস কেক', 'Bos Cake', false, 'PENDING_VERIFICATION'),
    ('bk-babarkhani', 'bakery', 'বাবরখানি', 'Babarkhani', true, NULL),
    ('bk-honey-toast', 'bakery', 'হানিম টোস্ট', 'Hanim Toast', false, 'PENDING_VERIFICATION'),
    ('bk-boro-bread', 'bakery', 'বড় ব্রেড', 'Large Bread', true, NULL),
    ('bk-choto-bread', 'bakery', 'ছোট ব্রেড', 'Small Bread', true, NULL),
    ('bk-bun', 'bakery', 'বন', 'Bun', true, NULL),
    ('bk-nagra', 'bakery', 'নাগরা', 'Nagra', true, NULL),
    ('bk-semai-500', 'bakery', 'বিভিন্ন স্বাদের সেমাই — ৫০০ গ্রাম', 'Assorted Flavour Semai — 500 g', true, NULL),
    ('bk-semai-250', 'bakery', 'বিভিন্ন স্বাদের সেমাই — ২৫০ গ্রাম', 'Assorted Flavour Semai — 250 g', true, NULL)
  ) AS v(slug, cat, name_bn, name_en, verified, outer_status)
  JOIN category c ON c.slug = v.cat
  ON CONFLICT (slug) DO NOTHING
  RETURNING id
)
INSERT INTO product_variant (id, product_id, updated_at) SELECT gen_random_uuid(), id, now() FROM new_products;
COMMIT;
