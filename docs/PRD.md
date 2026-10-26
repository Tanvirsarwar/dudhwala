# Product Requirements Document — Dudhwala Online Store

Status: Draft v0.1 — 2026-10-19
Brand spelling: "Dudhwala" (confirmed 2026-10-19).

## 1. Background

Dudhwala Food Products (দুধওয়ালা, tagline "Serving Purity") is a Sylhet-based dairy and food brand. Per the supplied invitation, it sells cow's raw milk and dairy products (doi, mishti, ghee) plus bakery items (bread, biscuits), and opened a showroom at Jalalabad Point, Sunamganj Road, Sylhet on 09 February 2026 to bring products closer to customers. The business now wants online ordering with home delivery across multiple outlets.

## 2. Objectives

1. Let Sylhet city customers order Dudhwala products online for scheduled home delivery.
2. Accept online payment (approved Bangladeshi gateway) and Cash on Delivery.
3. Run multiple outlets independently — own stock, staff, orders, riders, slots and reports — under central oversight.
4. Prevent overselling, overbooked delivery slots, and unverified payments.
5. Give the owner trustworthy consolidated reporting.

## 3. Target users

| User | Needs |
|------|-------|
| Household customers in Sylhet city, mostly on Android phones, Bangla-first | Quick reordering of daily items (milk, bread), clear prices, reliable delivery times, COD option |
| Super Admin (owner/head office) | Oversight of all outlets, catalogue, pricing, payments, reports |
| Outlet Manager | Run one outlet's orders, stock, slots and riders |
| Outlet Staff | Process and pack orders, update stock where allowed |
| Delivery Staff (riders) | See today's deliveries, contact customers, record outcomes and COD cash |

## 4. Scope (v1)

In scope:
- Bangla-first responsive storefront: home, categories, search/filter/sort, product detail, cart, checkout, order confirmation and tracking, account (OTP), addresses, order history, reorder.
- Delivery-area check, outlet eligibility, single-outlet fulfilment, delivery slots with capacity and cut-off, delivery fees and minimum orders per outlet and zone.
- Online payment via hosted checkout of one approved gateway; COD with configurable eligibility; separate payment and order states; reconciliation; refunds (SA).
- Admin app: consolidated and outlet dashboards, outlets, staff and roles, catalogue, outlet inventory (receive, adjust, write-off, counts, transfers), orders, picklists, slots, zones, rider assignment, COD handover, coupons, banners/content, reports and CSV, audit log, settings.
- Rider mobile web app.
- SMS notifications for key order events.
- Documentation, tests, CI/CD, staging and production deployment guides.

Out of scope for v1 (candidates for later):
- Subscriptions / recurring daily milk delivery (high value for this business — recommended v2).
- Native mobile apps; WhatsApp ordering; loyalty points; product reviews.
- Splitting one order across outlets; third-party courier integration; areas outside Sylhet city.
- Variable-weight items; batch/expiry tracking; POS integration for walk-in sales (stock changes from walk-in sales must be recorded manually as adjustments in v1 — **operational risk, see §8**).
- Map-pin geolocation and polygon zones.

## 5. Functional requirements

Detailed in APP_FLOW.md, API_SPECIFICATION.md and USER_ROLES_AND_PERMISSIONS.md. Key requirements with IDs for traceability:

| ID | Requirement |
|----|-------------|
| FR-1 | Customer can browse categories and search products in Bangla and English names. |
| FR-2 | Product pages show only business-approved content; optional fields hidden when empty. |
| FR-3 | Cart is server-side and re-priced on every view; browser prices never trusted. |
| FR-4 | Checkout validates area serviceability against configured areas only. |
| FR-5 | Order is assigned to exactly one eligible outlet using the documented algorithm; no silent split. |
| FR-6 | Customer can pick only slots with remaining capacity and before cut-off. |
| FR-7 | Concurrency cannot oversell stock or overbook slots. |
| FR-8 | Online payments are marked paid only after server-side gateway verification. |
| FR-9 | COD is offered only when eligibility rules allow; COD cash collection tracked separately. |
| FR-10 | Order history stores snapshots of item names, SKUs, prices and address. |
| FR-11 | Outlet staff see only their outlet's data; enforced server-side. |
| FR-12 | Riders see only their assigned deliveries with minimal customer data. |
| FR-13 | All stock changes record actor, time, reason, quantities. |
| FR-14 | Super Admin sees consolidated and per-outlet reports; CSV export permissioned and audited. |
| FR-15 | Sensitive actions are audit-logged. |
| FR-16 | Customers receive SMS for placed, out-for-delivery, delivered, failed (configurable). |
| FR-17 | Customers can cancel before confirmation; paid orders generate a refund task. |
| FR-18 | Reorder adds available items at current prices with change notices. |

## 6. Assumptions

- Sylhet city customers predominantly use mobile data on Android.
- Business can supply catalogue, photos, outlet details, areas, fees and policies before launch (OPEN_DECISIONS).
- One gateway is sufficient for v1; adapter design allows adding bKash/Nagad-specific integrations later.
- Order volume initially < 500/day.

## 7. Success metrics (first 90 days after launch)

Baselines and targets to be agreed with the business; proposed measures:
- Checkout conversion (cart → placed order).
- Share of orders delivered in the chosen slot.
- Oversell incidents (target: 0) and overbooked slots (target: 0).
- Payment exceptions unresolved > 24 h (target: 0).
- Failed-delivery rate and COD discrepancy count.
- Repeat-customer rate at 30 days.
- p75 LCP on product pages ≤ 2.5 s.

## 8. Risks

| Risk | Mitigation |
|------|------------|
| Walk-in showroom sales not reflected online → overselling | Stock buffer setting per outlet (hide last N units online); daily count; recommend POS integration in v2. |
| Gateway approval delays | COD-only launch possible with online payment toggled off; adapter ready. |
| Perishables and failed deliveries | Restock/write-off choice; reschedule limits; COD limits. |
| Inaccurate area lists | Areas editable by SA; serviceability check on every checkout. |
| Low digital literacy of staff | Simple order board, Bangla admin labels, training guide. |

## 9. Acceptance criteria (v1 release)

1. All FR-1…FR-18 demonstrated on staging by passing E2E scenarios E1–E18 (QA_TEST_PLAN §5).
2. Authorization matrix tests 100 % passing; zero high/critical open security findings.
3. Concurrency tests show zero oversell/overbook.
4. Accessibility: zero serious/critical axe violations on listed pages.
5. Performance budgets met on staging.
6. Backup restore test passed and recorded.
7. All "Launch"-blocking OPEN_DECISIONS closed and policies published.
8. Gateway live test transaction and refund completed (or online payment consciously disabled for a COD-only launch, signed off by the business).
