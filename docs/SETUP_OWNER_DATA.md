# What the owner must supply before launch (nothing here is invented)

| # | Needed | Why / where it goes | Today |
|---|---|---|---|
| 1 | **Outlets**: real name, address, phone, weekly opening hours | `owner-setup.json` → `cli/setup` (template: `apps/api/data/setup.example.json`) | none exist; home delivery, pickup and bulk are all unavailable |
| 2 | **Which outlet supplies home delivery** (`dispatchOutletCode`) | same file | unset → home delivery answers 503 |
| 3 | **Modina Market Branch** record (name given; address/phone/hours not) and confirmation it is the only bulk collection point (`collectionOutletCode`) | same file | unset → bulk answers 503 `BULK_NOT_CONFIGURED` |
| 4 | **Prices, pack sizes/labels, compare-at prices, max quantity per order** for each product | admin → Products (or a future bulk price import) | all 59 products have no price → cannot be ordered |
| 5 | **Stock counts** per outlet (or an explicit "do not count stock" for a product) | admin → product → stock; other outlets via `POST /admin/inventory` | no stock → out of stock |
| 6 | **Product photos** (owned or licensed) | admin → product → photo | none |
| 7 | **Confirm 11 unverified product names** and the English names (transliterations) | admin → product → "name verified" | flagged `nameVerified=false` |
| 8 | **Outer City list**: items marked `pending_verification` / `pending_confirmation` (ds-04 and 6 bakery names) | admin → product → Outer City | stay excluded until approved |
| 9 | **Bulk thresholds** (quantity and amount) | admin → Settings | placeholder 20 items / Tk 20,000, shown as "not final" until saved |
| 10 | **Ordering hours** confirmation (10:00–22:00 Dhaka assumed) | admin → Settings | default |
| 11 | ~~Payment provider~~ — not needed: the shop takes **cash on delivery only** | — | done |
| 12 | **SMS provider** for OTP (Bangladeshi bulk-SMS HTTP API): URL, parameter names, sender id, key | `SMS_HTTP_*` env | none → customers cannot log in in staging/production |
| 13 | Confirm cash is collected by the rider/at the showroom and who may mark orders paid (admin only today) | admin → order → "টাকা পাওয়া গেছে" | assumed |
| 14 | **Delivery fee** for In Sylhet and Outer Sylhet | admin → Settings → ডেলিভারি চার্জ | 0 (free) until set |
| 15 | **Page texts**: About, FAQ, delivery policy, terms, refund policy, privacy | `pages` array in the setup file | none → no page links |
| 16 | **Domain names**, hosting account, database, object-storage bucket + CDN URL | `.env` / hosting secrets | none |
| 17 | **Admin and manager people** (emails) | `cli/create-staff` | none |
| 18 | **Legal**: data retention, privacy/terms review | lawyer | open |

Never send passwords, database URLs or API keys in chat or commit them; set them in the host's secret store.

## First-time data entry, in order
1. `create-staff --role admin`, then log in at the admin site and enrol two-factor (save the recovery codes).
2. `setup --file owner-setup.json` (outlets, hours, dispatch + collection outlet, pages).
3. `import-catalogue` (products arrive hidden and unpriced; re-running changes nothing).
4. Admin: for each product set label, price, stock, photo, confirm the name, Outer City mark; switch **active** on. (`import-catalogue --activate` exists but only after prices are in.)
5. Admin → Settings: confirm hours and bulk thresholds (this clears the "placeholder" flag).
6. `create-staff --role manager` for read-only staff.
