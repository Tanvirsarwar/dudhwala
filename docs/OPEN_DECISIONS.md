> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Open Decisions

Status: Milestone 1 (Discovery) — 2026-10-19
Owner of business decisions: Dudhwala Food Products management.
Owner of technical decisions: project engineering lead.

Every item below is unresolved. Nothing here may be hard-coded. Where the system needs a value to run, it reads it from configuration (admin settings or environment), and the shipped default is either "disabled" or "empty" so that nothing fabricated reaches customers.

Legend — **Blocks**: the milestone that cannot complete without the answer. **Default**: what the system does until the decision is made.

---

## A. Brand and content

| # | Decision | Why it matters | Blocks | Default until decided |
|---|----------|----------------|--------|-----------------------|
| A1 | ~~Official English spelling~~ | **CLOSED 2026-10-19:** "Dudhwala". `BRAND_NAME_EN=Dudhwala`. | — | — |
| A2 | **Clean logo master files** (SVG or transparent PNG ≥ 1000 px wide, plus a single-colour version for dark backgrounds). The reference image is a flattened invitation; the logo sits on a milk-splash photo and cannot be cleanly extracted without redrawing. | Logo must not be redrawn or distorted (brief §2). | M4 | Partial (2026-10-19): logo lockup received as a 450×240 raster on the milk background (`assets/brand/logo-lockup-from-invitation.png`). Used as-is in demo builds, never recoloured or redrawn. **Still needed for launch:** SVG or transparent PNG ≥ 1000 px, plus a single-colour version. |
| A3 | Logo usage rules: minimum size, clear space, allowed backgrounds, whether "TM" and "Serving Purity" must always appear. | Consistent rendering in header, favicon, invoices, SMS/email. | M4 | Always show full lockup; never recolour. |
| A4 | **Brand typefaces.** The invitation uses hand-lettered Bangla display titles and a custom wordmark. Are licensed font files available? | Display headings. | M4 | Hind Siliguri (Bangla) + Inter (Latin), both under the SIL Open Font License. No imitation of the custom lettering. |
| A5 | **"জাতীয় স্বর্ণপদক প্রাপ্ত" (national gold-medal recipient) claim.** Which award, year, issuing body, and is there a certificate we may display? | Brief forbids unverified certifications/achievements. | M4 (About page) | Claim is **not** shown anywhere until verified evidence is supplied and approved. |
| A6 | About-us copy, FAQ copy, policies (terms, privacy, refund/return, delivery, cancellation) — approved text in Bangla, plus English if wanted. | Legal and trust content. | M4 / launch | Pages exist, editable in admin, show "content pending" only in staging; production launch checklist blocks on them. |
| A7 | English translation: is English required at launch, and who approves translations? | i18n scope. | M4 | Bangla-only UI strings ship; English locale scaffolded but hidden. |
| A8 | Product photography: who supplies it, format, background style. | Brief forbids fabricated packaging. | M4 | Products without an approved photo show a neutral, brand-coloured "photo coming soon" tile — never a stock/AI image. |

## B. Catalogue and pricing

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| B1 | Full product list, categories, variants/pack sizes, SKUs. Reference image names: cow's raw milk (গরুর খাঁটি কাঁচা দুধ), doi, mishti, ghee, bread, biscuits, bakery items. | M4 | Empty catalogue in production. For demos only: 14 cakes (names, prices, hot-linked images) from a third-party bakery listing, loaded by `db:seed:demo`, labelled DEMO everywhere, removed by `db:purge:demo`. |
| B2 | ~~One price or per-outlet price?~~ | **CLOSED 2026-10-19:** one global price per variant at all outlets. No per-outlet price table in v1. | — | — |
| B3 | VAT/tax: are listed prices VAT-inclusive? Is a VAT registration (BIN) shown on invoices? Any Mushak invoice requirement? | M5 | Prices treated as tax-inclusive; no tax line computed. Needs accountant confirmation before launch. |
| B4 | Ingredients, allergens, storage instructions, shelf life per product, and who verifies them. | M4 | Fields are optional and hidden when empty. |
| B5 | Sold by weight/volume with variable final weight (e.g. mishti per kg)? | M2 | Fixed pack sizes only. Variable-weight items require a design change; flag early. |
| B6 | Perishable stock: do we track batches/expiry dates? | M2 | Not tracked in v1 (quantity only). Schema leaves room for a `StockBatch` table. |

## C. Outlets and operations

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| C1 | List of outlets at launch. Known from the reference image: showroom at 193 Shuvechchha, Mia Fazil Chist, Jalalabad Point, Sunamganj Road, Sylhet (+880 1345-876967), opened 09 Feb 2026. Is this an outlet that fulfils online orders? Others? | M3 | No outlets seeded in production. |
| C2 | Operating hours per outlet, days closed, holiday calendar. | Launch | **Implemented (2026-10-21):** weekly hours and closure days per outlet in the admin (**খোলার সময় ও ছুটি**). With hours set, slots are generated only inside them; with none set, slot templates alone decide. Business must enter real hours and holidays. |
| C3 | Who confirms orders: auto-confirm on placement, or must outlet staff accept? Allowed rejection reasons. | M5 | Manual confirmation required; configurable per outlet. |
| C4 | Inter-outlet stock transfers: enabled at launch? Who approves? | Launch | **Implemented (2026-10-21)**, off by default (`inventory.transfers.enabled`). Flow: manager requests → Super Admin approves → source dispatches → destination receives (shortfalls recorded). Business decides whether to switch it on. |
| C5 | ~~Staff in multiple outlets?~~ | **CLOSED 2026-10-19:** each staff member works at exactly one outlet. Super Admin is global and not assigned to an outlet. | — | — |
| C6 | Failed delivery of perishables: return to stock, or write off? Who decides? | M6 | Staff must choose "restock" or "write-off" with a reason; both audited. |

## D. Delivery

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| D1 | **Serviceable neighbourhoods of Sylhet city**, per outlet. | M5 | No area serviceable → checkout cannot complete. |
| D2 | Delivery fee rules: flat per area, by order value tiers, free-delivery threshold? | M5 | Fee engine supports flat-per-area + optional free-above threshold; values empty. |
| D3 | Minimum order value per area/outlet. | M5 | None (0) — confirm. |
| D4 | Delivery slots: lengths, times, days, capacity per slot, cut-off (e.g. order N hours before slot start). | M5 | No slots → no checkout. |
| D5 | Same-day delivery offered? | M5 | Allowed only if a slot exists and cut-off not passed. |
| D6 | Rider model: in-house riders, third-party courier, or both? | M6 | In-house riders as `DELIVERY_STAFF` users. Courier integration out of scope v1. |
| D7 | Proof of delivery: none, OTP code from customer, photo, or signature? | M6 | Delivery-code (4-digit OTP shown to customer) supported but disabled; photo capture disabled pending privacy approval. |
| D8 | Rescheduling policy: who may reschedule, how many times, any fee? | M6 | Customer may request; outlet staff approve; max attempts configurable (default 2 attempts before order closes as failed). |
| D9 | Cancellation window: until which order status can a customer self-cancel? | M5 | Until `CONFIRMED` (before preparation starts). |
| D10 | Customer address precision: free-text + area dropdown, or also a map pin? | M5 | Free-text + area dropdown. Map pin is optional future work (needs a maps provider and its cost). |

## E. Payments

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| E1 | **Online payment gateway.** Candidates: SSLCOMMERZ, bKash Tokenized Checkout, Nagad, aamarPay, shurjoPay, Portwallet. | Launch | **SSLCOMMERZ adapter implemented (2026-10-21)** — sandbox/live by env, tested against a protocol mock (PAYMENT_GATEWAY_GUIDE.md). The business still chooses the gateway and opens the merchant account; another gateway = one new adapter. Online payment stays off (`payments.online.enabled=false`) until live credentials and a live test transaction. |
| E2 | Merchant onboarding documents status (trade licence, TIN/BIN, bank account, website with policies). Gateways typically require the live website with policies before approval — plan for this. | Launch | — |
| E3 | Refund policy and who authorises refunds; partial refunds allowed? | M5 | Only Super Admin can initiate; reason mandatory. |
| E4 | COD eligibility rules: max order value, areas, first-time customers, per-outlet. | M5 | COD **off** until rules configured. |
| E5 | COD cash handover process: rider hands cash to outlet manager daily? Who records receipt? | M6 | Two-step: rider marks collected → manager confirms handover; mismatch flagged. |
| E6 | Settlement reconciliation: who reconciles gateway settlement reports, how often? | M6 | Daily reconciliation report available to Super Admin. |
| E7 | Payment hold time for unpaid online orders before stock/slot is released. | M5 | Technical default 15 minutes, configurable. |

## F. Customers and communication

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| F1 | Login method: phone OTP only, or also password? Guest checkout allowed? | M4 | Phone OTP accounts; guest checkout allowed with phone OTP verification at checkout (gives same order-tracking security). |
| F2 | SMS provider (Bangladesh, masking/non-masking sender ID approval). | Launch | **Generic HTTP SMS adapter implemented (2026-10-21)** — map the chosen provider's API with `SMS_HTTP_*` env vars. Business chooses the provider and gets the sender id approved. Staging/production refuse to start without a real provider. |
| F3 | Email used at all? Transactional email provider? | M6 | Email optional; customers not required to give one. |
| F4 | Which events notify customers (placed, confirmed, out for delivery, delivered, failed, refunded)? | M6 | Placed, out-for-delivery, delivered, failed. |
| F5 | WhatsApp notifications — only if an approved provider and need exist. | Post-launch | Off. |
| F6 | Data retention: how long to keep order and address data; account deletion handling. | Launch | **Implemented (2026-10-21):** customers download their data and request deletion; a Super Admin completes it (account and order contact details anonymised, order amounts kept). Expired sessions/OTP records purged after 30 days. **Retention periods and any legal basis still need confirmation by a lawyer** (Bangladesh personal data law status). |

## G. Coupons and promotions

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| G1 | Coupon types needed: percentage, fixed amount, free delivery? Stackable? | M5 | Percentage and fixed, one coupon per order, not stackable. |
| G2 | Banners and featured collections — who approves content? | M4 | Admin-managed, empty by default. |

## H. Technical / infrastructure (need business approval for cost)

| # | Decision | Blocks | Default |
|---|----------|--------|---------|
| H1 | **Hosting provider and region.** Decision 2026-10-19: managed container PaaS, lowest-risk option, cost not the constraint. Exact provider chosen together with the business before M8 (Singapore region preferred). | M8 | Docker images keep the choice portable. |
| H2 | Managed PostgreSQL with HA standby, PITR ≥ 7 days, plus nightly off-site dump. Provider chosen with H1. | M8 | — |
| H3 | Object storage for images (S3-compatible: Cloudflare R2, DigitalOcean Spaces, AWS S3, Backblaze B2). | M4 | Local disk in dev; S3 adapter. |
| H4 | Domain name and who owns the registrar account. | M8 | — |
| H5 | Error tracking (e.g. Sentry) and uptime monitoring provider. | Launch | Not wired yet: platform logs and uptime checks only (DEPLOYMENT_RUNBOOK §10). Choose with H1. |
| H6 | ~~Budget~~ | **CLOSED 2026-10-19:** cost does not constrain hosting; business will adjust pricing if needed. SMS and gateway fees still tracked and reported. | — | — |
| H7 | Who operates the system after launch (on-call, updates)? | Launch | — |

---

## Decisions already fixed by the brief (not open)

- Initial delivery boundary: Sylhet city only, and only configured areas within it.
- Payment methods: online gateway + COD; payment status separate from order status.
- Multiple outlets from day one, each with independent inventory, staff, orders, delivery, slots, reports.
- One order is fulfilled by exactly one outlet; no silent splitting.
- Super Admin oversees all outlets.

## Change log

- 2026-10-19 — Initial list created during discovery.
- 2026-10-19 — A1, B2, C5 closed; H6 answered (budget), H1/H2 narrowed to single-VPS self-hosting.

- 2026-10-19 — H6 closed: risk-free managed hosting preferred over low cost; single-VPS plan withdrawn.
- 2026-10-19 — A2 partially answered (raster logo); demo catalogue added for non-production use.
- 2026-10-21 — C2, C4, E1 (adapter), F2 (adapter), F6 (workflow) implemented; business choices and legal confirmation still open.