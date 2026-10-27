# V2.5 catalogue mapping (demo)

Source: `dudhwala-product-delivery-eligibility.md` (transcription of photographed printed lists). **Names and Outer City marks only.** The source contains no prices, pack sizes, stock, photos or outlet mapping, so none were invented: prices and stock are `null` in `demo/mock-api/catalogue.json`, every product has one placeholder variant with no label, and the UI shows "Price to be announced".

English names (`nameEn`) are transliterations added for the bilingual UI and need the owner's approval. Dairy Sweets rows 21-22 were unreadable in the source and are **not** included.

## Outer City state per product

| State | Count |
|---|---|
| not eligible | 27 |
| pending_verification | 7 |
| eligible (ticked Dairy Sweet) | 2 |
| pending_confirmation | 4 |
| eligible (Bakery rule) | 19 |

Rules (single place: `ELIGIBILITY_RULES` in `packages/shared/src/ordering.ts`): In City = everything. Outer City = whole Bakery category + Dairy Sweets items flagged `approved`; Doi and every item flagged `pending_*` or `disabled` are excluded. A flag can only restrict, never widen.

## Products needing owner confirmation

| ID | Bangla | English (proposed) | Why |
|---|---|---|---|
| ds-04 | মতি লাড্ডু | Moti Laddu | spelling unclear in source; kept out of Outer City until verified |
| ds-11 | সরপোড়া সন্দেশ | Sarpora Sandesh | spelling unclear in source |
| ds-12 | দধিয়া সন্দেশ | Dadhiya Sandesh | spelling unclear in source |
| ds-14 | বোন্দে সন্দেশ | Bonde Sandesh | spelling unclear in source |
| ds-20 | সরভোল | Sarbhol | spelling unclear in source |
| doi-03 | বাটি দই | Bati Doi | Doi tick: confirm whether it counts for Outer City |
| doi-04 | প্রিমিয়াম দই | Premium Doi | Doi tick: confirm whether it counts for Outer City |
| doi-06 | প্রিমিয়াম কাপ দই | Premium Cup Doi | Doi tick: confirm whether it counts for Outer City |
| doi-07 | কাপ দই | Cup Doi | Doi tick: confirm whether it counts for Outer City |
| bk-vanilla-biscuit | ভ্যানিলা বিস্কুট | Vanilla Biscuit | spelling unclear in source; kept out of Outer City until verified |
| bk-salt-biscuit | সল্ট বিস্কুট | Salt Biscuit | spelling unclear in source; kept out of Outer City until verified |
| bk-dry-cake | ড্রাই কেক | Dry Cake | spelling unclear in source; kept out of Outer City until verified |
| bk-sweet-cake | সুইট কেক | Sweet Cake | spelling unclear in source; kept out of Outer City until verified |
| bk-bos-cake | বোস কেক | Bos Cake | spelling unclear in source; kept out of Outer City until verified |
| bk-honey-toast | হানিম টোস্ট | Hanim Toast | spelling unclear in source; kept out of Outer City until verified |

## Full list

### Dairy Sweets (দুগ্ধজাত মিষ্টি)

| ID | Bangla | English | Outer City |
|---|---|---|---|
| ds-01 | সাদা রসগোল্লা | White Rasgulla | no |
| ds-02 | কালোজাম | Kalojam | no |
| ds-03 | গোলাপজাম | Golapjam | no |
| ds-04 | মতি লাড্ডু | Moti Laddu | no (pending) |
| ds-05 | রসমালাই | Rosh Malai | no |
| ds-06 | দুধরাজ | Dudhraj | no |
| ds-07 | ক্ষীরমোহন | Kheer Mohan | no |
| ds-08 | জাফরান ভোগ | Zafran Bhog | no |
| ds-09 | মালাইচপ | Malai Chop | no |
| ds-10 | কাঁচা সন্দেশ | Kacha Sandesh | no |
| ds-11 | সরপোড়া সন্দেশ | Sarpora Sandesh | no |
| ds-12 | দধিয়া সন্দেশ | Dadhiya Sandesh | no |
| ds-13 | গুড়ের সন্দেশ | Gurer Sandesh | no |
| ds-14 | বোন্দে সন্দেশ | Bonde Sandesh | no |
| ds-15 | অরেঞ্জ সন্দেশ | Orange Sandesh | no |
| ds-16 | সাদা চমচম | White Chomchom | no |
| ds-17 | বাদামী চমচম | Brown Chomchom | no |
| ds-18 | পাতা চমচম | Pata Chomchom | no |
| ds-19 | কাশ্মীরী ভোগ | Kashmiri Bhog | no |
| ds-20 | সরভোল | Sarbhol | no |
| ds-23 | দুধ | Milk | no |
| ds-24 | ঘি | Ghee | yes |
| ds-25 | নিমকি | Nimki | yes |

### Doi / Dairy (দই ও দুগ্ধজাত)

| ID | Bangla | English | Outer City |
|---|---|---|---|
| doi-01 | প্রিমিয়াম দই সরা | Premium Doi Shara | no |
| doi-02 | পাতিল দই | Patil Doi | no |
| doi-03 | বাটি দই | Bati Doi | no (pending) |
| doi-04 | প্রিমিয়াম দই | Premium Doi | no (pending) |
| doi-05 | টক দই | Tok Doi (Sour Curd) | no |
| doi-06 | প্রিমিয়াম কাপ দই | Premium Cup Doi | no (pending) |
| doi-07 | কাপ দই | Cup Doi | no (pending) |
| doi-08 | মাঠা ৫০০ গ্রাম | Matha 500 g | no |
| doi-09 | মাঠা ২৫০ গ্রাম | Matha 250 g | no |
| doi-10 | ঘোল ৫০০ গ্রাম | Ghol 500 g | no |
| doi-11 | ঘোল ২৫০ গ্রাম | Ghol 250 g | no |

### Bakery (বেকারি)

| ID | Bangla | English | Outer City |
|---|---|---|---|
| bk-badam-biscuit | বাদাম বিস্কুট | Badam Biscuit | yes |
| bk-kaju-badam-biscuit | কাজু বাদাম বিস্কুট | Cashew Nut Biscuit | yes |
| bk-coconut-biscuit | কোকোনাট বিস্কুট | Coconut Biscuit | yes |
| bk-vanilla-biscuit | ভ্যানিলা বিস্কুট | Vanilla Biscuit | no (pending) |
| bk-salt-biscuit | সল্ট বিস্কুট | Salt Biscuit | no (pending) |
| bk-dry-cake | ড্রাই কেক | Dry Cake | no (pending) |
| bk-cha-toast | চা টোস্ট | Cha Toast | yes |
| bk-charcoal | চারকোল | Charcoal | yes |
| bk-sweet-cake | সুইট কেক | Sweet Cake | no (pending) |
| bk-fruit-cake | ফ্রুট কেক | Fruit Cake | yes |
| bk-butter-toast | বাটার টোস্ট | Butter Toast | yes |
| bk-badam-toast | বাদাম টোস্ট | Badam Toast | yes |
| bk-bread-toast | ব্রেড টোস্ট | Bread Toast | yes |
| bk-baby-toast | বেবি টোস্ট | Baby Toast | yes |
| bk-badam-cake | বাদাম কেক | Badam Cake | yes |
| bk-toast-cake | টোস্ট কেক | Toast Cake | yes |
| bk-bos-cake | বোস কেক | Bos Cake | no (pending) |
| bk-babarkhani | বাবরখানি | Babarkhani | yes |
| bk-honey-toast | হানিম টোস্ট | Hanim Toast | no (pending) |
| bk-boro-bread | বড় ব্রেড | Large Bread | yes |
| bk-choto-bread | ছোট ব্রেড | Small Bread | yes |
| bk-bun | বন | Bun | yes |
| bk-nagra | নাগরা | Nagra | yes |
| bk-semai-500 | বিভিন্ন স্বাদের সেমাই — ৫০০ গ্রাম | Assorted Flavour Semai — 500 g | yes |
| bk-semai-250 | বিভিন্ন স্বাদের সেমাই — ২৫০ গ্রাম | Assorted Flavour Semai — 250 g | yes |

## Replaced

The V2.4 sample catalogue (30 invented products in 10 categories) and its English dictionary entries were removed. Nothing from it remains in the demo data.
