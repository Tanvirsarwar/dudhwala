# Phase 2 — backend: plan, status, how to verify

## 1. Audit result (what was there)
The repository already held a large NestJS/Prisma backend (258 passing tests) built for a different business model: delivery areas, time slots, cash on delivery, riders, coupons, per-outlet zone rules. It did not match the V2.7 rules (In Sylhet/Outer Sylhet zones, pickup, bulk, 10:00–22:00 ordering). Decision: **keep the infrastructure** (sessions, Argon2id, TOTP, CSRF, rate limits, idempotency, audit, S3 media, CLI pattern) and **replace the domain layer** with a compact one. Frontends were not redesigned: they changed only behind the existing service boundaries (`apps/web/lib/services`).

## 2. Checklist
| # | Item | Status |
|---|---|---|
| 1 | Compact schema + versioned migration (`0005_v2_domain`, CHECK constraints, append-only audit/stock/status tables) | done |
| 2 | Auth: customer OTP, staff login per role page, Argon2id, sessions, CSRF, rate limits, lockout, TOTP 2FA + recovery codes, ADMIN/MANAGER, audit | done |
| 3 | Catalogue: public + admin CRUD, variants, prices, image upload (S3 / dev disk), hidden-by-default, audit with before/after | done |
| 4 | Stock: per outlet, atomic reserve / commit / release, append-only ledger, no overselling (tested with parallel orders) | done |
| 5 | Orders: server pricing, zones, hours, pickup, bulk (quantity OR amount), idempotency, ownership, status flow, cancel | done |
| 6 | Payment: cash on delivery only — method/status stored per order, staff mark cash received; online payment code removed (Supabase update) | done |
| 7 | Settings: hours, bulk thresholds (flagged unapproved until saved), dispatch + collection outlets, owner pages | done |
| 8 | CLI: `create-staff`, `setup`, `import-catalogue` (idempotent), `reset-mfa` | done |
| 9 | Storefront + admin wired to the real API (OTP gate, orders, bulk payment step, MFA screens) | done |
| 10 | Tests, docs, deployment files | done (below) |
| 11 | SMS provider, real data, live deployment | **waiting on the owner** — [SETUP_OWNER_DATA](SETUP_OWNER_DATA.md) |

## 3. What changed in the repository
- `apps/api`: new domain modules `catalog`, `cart`, `orders`, `payments`, `outlets`, `inventory`, `settings`, `content`, `jobs`; removed delivery/slots/COD/rider/coupon/finance/notification/privacy modules and their tests. Schema rewritten; migration `0005_v2_domain` **drops all old tables** (there is no production data; see DEPLOY_PHASE2 before running it anywhere that has data).
- `packages/shared`: new `ORDER_FLOW`, `nextOrderStatuses`, live status labels; legacy modules (pricing/coupon, slots/outlet selection, old state machines, permission matrix) removed. Demo exports (`DEMO_*`, `ORDER_STATUS_FLOW`) kept for the local demo.
- `apps/web`: live mode (any build without `NEXT_PUBLIC_DEMO_BRANDING=1`) now uses the V2 zone/pickup/bulk experience against the real API; old area/slot/COD screens and the area bar are gone. Unpriced products cannot be added to the cart outside the demo.
- `apps/admin`: handles live statuses and `orderNumber`, two-factor enrolment/verification page (`/mfa`), outlet and payment status in Settings. Demo reset button shows only in the demo build.
- `e2e/`: the old API-stack Playwright suite and its CI workflow were removed (they tested the removed design); demo suites remain; `e2e/demo/live.cjs` is the new live-shop browser test.

## 4. Tests (run 2026-10-28, local PostgreSQL 16, isolated throw-away database per run)
| Suite | Result |
|---|---|
| API integration/unit (`pnpm --filter @dudhwala/api test`) | **159 / 159** in 11 files: orders, order status, payments, auth, catalogue/admin/images, config/outlets/cart/audit/CLI/env guards, API-shape contract, cookies/CORS/CSRF, S3 media, pool, TOTP |
| Shared (`pnpm --filter @dudhwala/shared test`) | 72 / 72, coverage 97.9 % statements |
| Lint + typecheck, all packages | 0 errors |
| Demo mock API (`pnpm test:demo`) | 19 / 19 |
| Demo browser suites (storefront, admin, platform incl. a11y/axe/responsive/EN, resilience) | 83 + 70 + 54 + 8, all pass — demo behaviour unchanged |
| Live-shop browser test (`e2e/demo/live.cjs`: real API + PostgreSQL) | 17 / 17 (before the COD update, see §8): OTP login at checkout, order with server price, My orders, anonymous cannot see it, admin 2FA enrolment, status change visible to customer, manager read-only, bulk order → sandbox payment → PREPAID, no console/5xx errors |

What the API tests cover (mandatory categories): authentication, role permissions, manager read-only, ownership, ordering hours (09:59/10:00/21:59/22:00), zones and Outer Sylhet eligibility, pickup lead time and outlet hours, bulk by quantity and by amount (and below), server-side pricing (client prices rejected), stock reservation/overselling/cancel/commit, idempotent and parallel-duplicate orders, status transitions, image upload validation, catalogue import idempotence, audit log append-only, env production guards, rate limiting and lockout.

**Not verified (cannot be in this sandbox):** `prisma migrate deploy` with Prisma's native engine (the migration SQL was generated from the schema and applied with `psql`; the repository CI runs `prisma migrate deploy` and a drift check — if it reports drift, run the `generate-migration` workflow and commit its output); a real payment gateway; a real SMS provider; S3 against a real bucket (covered only by a protocol-level test); a hosted deployment; load testing; an external penetration test.

## 5. Commands
```bash
pnpm install && pnpm prepare:codegen && pnpm lint && pnpm typecheck
export TEST_ADMIN_DATABASE_URL=postgresql://USER:PASS@HOST:5432/postgres   # a throw-away server; never a real database
pnpm --filter @dudhwala/api test
cd apps/api && pnpm build
DATABASE_URL=… pnpm exec prisma migrate deploy
DATABASE_URL=… STAFF_PASSWORD=… node dist/cli/create-staff.js --role admin|manager --email … --name …
DATABASE_URL=… node dist/cli/setup.js --file owner-setup.json
DATABASE_URL=… node dist/cli/import-catalogue.js [--file path] [--activate]
DATABASE_URL=… node dist/cli/reset-mfa.js --email …
```

## 6. Live-shop browser test (local)
1. Throw-away PostgreSQL; apply `apps/api/prisma/migrations/*/migration.sql` in order with `psql`.
2. API env: `NODE_ENV=development SMS_PROVIDER=log ENABLE_DEV_OUTBOX=true` plus origins `http://127.0.0.1:3200` / `:3201`, secrets, `MEDIA_DIR`. `node dist/main.js`.
3. `node dist/cli/setup.js` with an outlet `MODINA-MARKET` (dispatch + collection), `import-catalogue --activate`, `create-staff` for `admin@live.test` / `manager@live.test`; set price 5000 and stock for products `ds-01`, `ds-02` (the test uses these) via SQL or the admin.
4. Build web/admin **without** `NEXT_PUBLIC_DEMO_BRANDING` and with `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000/v1`; `next start -p 3200` / `-p 3201`. Clear `apps/web/.next/cache/fetch-cache` between runs (catalogue pages cache for 30 s by design).
5. `PW_CHROMIUM_PATH=… node e2e/demo/live.cjs`. Use a fresh database each run (the test enrols the admin's 2FA).

## 7. Known limitations and decisions
- Prices/stock are served from a 30-second page cache on the storefront; the API itself is uncached.
- Home delivery and pickup orders carry **no online payment** (`paymentStatus=NOT_REQUIRED`): payment is taken offline on delivery/pickup. This follows the demo wording and is an owner decision to confirm.
- Delivery fee is 0 (not specified by the owner); the column and totals already support a fee.
- Customers cannot cancel; staff cancel. No refund automation: a paid-then-cancelled bulk order is flagged in the audit log (`payment.refund_required`) for manual refund.
- Product photos: one per product; replaced images stay in the bucket (no delete from storage).
- Search is `ILIKE` (no trigram index); fine for hundreds of products.
- Variant removal is blocked once it has orders or stock history (append-only ledger).

## 8. Update — UI refinement, COD only, Supabase lockdown
- Zones are now labelled **In Sylhet / Outer Sylhet** (Bangla UI: ইন সিলেট / আউটার সিলেট) everywhere; the stored values stay `IN_CITY` / `OUTER_CITY`. Each zone has its own home-delivery fee (admin Settings, default 0); the server computes it and stores zone + fee on the order.
- The Bulk Order action is now **Order From Showroom** (same page, same flow: collection at Modina Market Branch). The 20-item / amount rule and the `BULK_ORDER` method name remain internally.
- Online payment removed: no gateway code, tables, env variables or webhook. Orders carry `paymentMethod=COD` and `paymentStatus=UNPAID|PAID`; admins record cash received.
- Migration `0006_cod_only_rls` (tested on data) and Row Level Security on every table: see [SUPABASE_VERCEL](SUPABASE_VERCEL.md).
- Tests after this update: API 152/152, shared 73/73, demo mock 19/19, live-shop browser test 28/28; demo browser suites see the final report. (The API test count fell because the payment/webhook tests were removed with the feature; new COD, fee, showroom and RLS tests were added.)
