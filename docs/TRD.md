# Technical Requirements Document

Status: Draft v0.1 — 2026-10-19
Related: PRD.md, DATABASE_SCHEMA.md, API_SPECIFICATION.md, SECURITY_REVIEW.md, DEPLOYMENT_RUNBOOK.md

## 1. Architecture summary

A modular monolith: one NestJS API owning all business logic and the database, two Next.js front-ends (storefront and admin) that talk only to the API. No microservices. Background work runs inside the API process using a PostgreSQL-backed job table until load proves otherwise.

```
            Customers (mobile browsers)          Staff / Riders
                     │                                 │
           ┌─────────▼─────────┐             ┌─────────▼─────────┐
           │ apps/web (Next.js) │             │ apps/admin (Next.js)│
           │ storefront, SSR    │             │ admin + rider PWA   │
           └─────────┬─────────┘             └─────────┬─────────┘
                     │  HTTPS JSON (cookies)            │
                     └──────────────┬───────────────────┘
                           ┌────────▼────────┐        ┌──────────────────┐
                           │ apps/api (NestJS)│◄──────│ Payment gateway   │
                           │ REST /v1         │ IPN/  │ (hosted checkout) │
                           │ jobs, scheduler  │ webhook└──────────────────┘
                           └──┬─────┬─────┬──┘
                    Prisma    │     │     │  HTTPS
              ┌───────────────▼┐ ┌──▼───┐ ┌▼──────────────┐
              │ PostgreSQL 16+  │ │ S3-  │ │ SMS / email    │
              │ (managed)       │ │ store│ │ providers      │
              └─────────────────┘ └──────┘ └────────────────┘
```

Rules:

- Front-ends never hold database credentials and never call providers with secrets.
- Every price, stock, slot, eligibility and payment decision is made in the API inside a database transaction.
- Storefront public pages (home, category, product) are server-rendered with short revalidation; personalised data (cart, account, orders) is fetched client-side or rendered dynamically with `no-store`.

## 2. Repository layout (pnpm workspaces + Turborepo)

```
dudhwala/
├─ apps/
│  ├─ api/        NestJS 11, Prisma, Jest
│  ├─ web/        Next.js (App Router) storefront, bn-first i18n
│  └─ admin/      Next.js admin + /rider routes (PWA manifest)
├─ packages/
│  ├─ shared/     zod schemas, DTO types, enums, money + phone utils (pure TS, unit-tested)
│  ├─ ui/         design tokens, Tailwind preset, Radix-based components
│  └─ config/     eslint, tsconfig, prettier presets
├─ e2e/           Playwright suites (storefront, admin, rider)
├─ infra/         Dockerfiles, docker-compose.dev.yml, deploy scripts
├─ docs/          this documentation set
└─ .env.example
```

Why separate admin app: separate origin (`admin.` subdomain) gives isolated cookies, a stricter CSP, an independent deploy, and keeps admin code out of the customer bundle.

## 3. Technology choices

Exact versions are pinned when the repository is scaffolded (Milestone 3) after checking each project's current official release notes. Major versions below are the intended baseline.

| Concern | Choice | Reason |
|---------|--------|--------|
| Language | TypeScript (strict) | Brief requirement; shared types across apps. |
| API framework | NestJS | Brief requirement; modules, guards, DI suit RBAC and outlet scoping. |
| ORM | Prisma 7.10.1 (pinned) with `@prisma/adapter-pg` | Brief requirement. Prisma 7 reads the connection URL from `prisma.config.ts`, not the schema. Raw SQL (`$queryRaw` tagged templates) used only for the conditional-update concurrency statements. |
| DB | PostgreSQL ≥ 16 | Transactions, row locks, partial indexes, `CHECK` constraints. |
| Validation | zod schemas parsed in each controller (`parse()`), strict objects (unknown fields rejected) | Explicit, testable validation at the API boundary. |
| Auth | Own session module: opaque random session tokens (SHA-256 hashed in DB), HttpOnly cookies | Server-side revocation, simpler than JWT refresh rotation. |
| Password hashing | argon2id | Staff accounts only. |
| MFA | TOTP (RFC 6238) for Super Admin and Outlet Manager | No SMS cost; works offline. |
| Customer auth | Phone OTP via SMS provider adapter | Bangladeshi users expect phone login. |
| Front-end | Next.js 16 App Router (React 19), server components for public pages, Tailwind CSS v4 with the design tokens, native `<dialog>` and hand-written accessible components (no UI kit), self-hosted Hind Siliguri + Inter via Fontsource | Small dependency surface; SSR for catalogue pages; standalone output for containers. |
| Forms | Plain controlled React forms with native validation; the API is the source of truth for errors | No form library needed at this size. |
| Data fetching (client) | `fetch` with small hooks (`useLoad`/`useAction`); rider page keeps an offline queue of status updates | Minimal dependencies. |
| i18n | Bangla UI strings in code; English product/page fields stored where supplied (no i18n framework yet) | English UI is not in scope until approved translations exist (OPEN_DECISIONS A7). |
| Images | Upload via API: magic-byte check, size limit, SVG refused, re-encoded to WebP with sharp (metadata stripped); local disk in development, S3-compatible bucket + CDN elsewhere | |
| Jobs / schedules | Own runner: `job` table polled every 2 s with `FOR UPDATE SKIP LOCKED`, retries with back-off, stale-lock recovery | No Redis needed; safe with several API instances. |
| Rate limiting | Own fixed-window counters in PostgreSQL (`rate_limit_bucket`, atomic upsert) | Shared across instances without Redis. |
| Logging | Nest logger to stdout; request id on every response and on unexpected-error logs; phones masked; gateway payloads redacted | Structured JSON logging can be added with the monitoring provider. |
| Error tracking | Not wired yet; platform logs + uptime checks (OPEN_DECISIONS H5) | Add with the hosting choice. |
| Testing | Vitest (unit + API integration with supertest against a real PostgreSQL 16), Playwright + @axe-core/playwright (E2E, accessibility), GitHub Actions (CI, E2E, image builds) | Real database in every integration test; no mocks of the data layer. |
| CI | GitHub Actions: `ci.yml` (lint, typecheck, migrations + drift, tests, builds), `e2e.yml` (Playwright full stack), `images.yml` (container builds; manual per-environment push to GHCR) | |
| Containers | `infra/docker/api.Dockerfile` (server + `migrate` target), `infra/docker/next.Dockerfile` (`APP=web|admin`, Next.js standalone) | Keeps hosting provider portable (OPEN_DECISIONS H1). |
| Hosting (v1) | Managed container PaaS + managed PostgreSQL with HA and PITR | Lowest operational risk (DEPLOYMENT_RUNBOOK §1.1). Provider selected with the business later. |

## 4. Domain modules (API)

| Module | Responsibility |
|--------|----------------|
| `auth` | OTP, staff login, sessions, MFA, CSRF token issuance |
| `access` | Roles, permissions, outlet scope resolution, guards |
| `outlets` | Outlet CRUD, hours, staff assignment |
| `catalog` | Categories, products, variants, images, collections, banners |
| `inventory` | Stock levels, reservations, movements, transfers, low-stock alerts |
| `delivery` | Areas, zones, outlet-zone rules, slot templates, slot instances, capacity, assignments, attempts |
| `cart` | Server cart (customer or anonymous token), pricing preview |
| `pricing` | Pure functions: subtotal, discount, delivery fee, total (integer poisha) |
| `fulfilment` | Outlet eligibility + selection algorithm |
| `checkout` | Quote → place order transaction |
| `orders` | Order state machine, status events, cancellation, rescheduling |
| `payments` | Gateway adapter interface, initiation, IPN/webhook, verification, reconciliation, refunds, COD collection |
| `coupons` | Definitions, eligibility, redemption counting |
| `customers` | Profiles, addresses, privacy requests |
| `notifications` | Templates, outbox, SMS/email adapters, retries |
| `reports` | Outlet and consolidated reports, CSV export |
| `audit` | Append-only audit log |
| `settings` | Typed business settings with audit |

## 5. Key technical designs

### 5.1 Money
All amounts are integers in **poisha** (1 BDT = 100 poisha), column type `INTEGER` (max ≈ ৳21.4 M per value — ample for single orders). Report aggregates use `BIGINT`/`SUM` cast. Percentage discounts stored as basis points (1% = 100 bp) and rounded with a single documented rule (round half up to the poisha, applied once on the discountable subtotal). Shared `Money` helpers in `packages/shared` are the only place arithmetic happens.

### 5.2 Inventory concurrency
Available = `quantity_on_hand − reserved_quantity`. Reservation is one statement per line inside the order transaction:

```sql
UPDATE inventory
SET reserved_quantity = reserved_quantity + $qty, updated_at = now()
WHERE outlet_id = $outlet AND product_variant_id = $variant
  AND quantity_on_hand - reserved_quantity - online_buffer_qty >= $qty
RETURNING id;
```

`online_buffer_qty` (per outlet × variant, default 0) protects against walk-in showroom sales that are not yet recorded (PRD §8).

Zero rows returned ⇒ insufficient stock ⇒ transaction rolls back. A `CHECK (reserved_quantity >= 0 AND quantity_on_hand >= 0 AND reserved_quantity <= quantity_on_hand)` constraint is the final guard. Lines are processed in a deterministic order (by variant id) to avoid deadlocks. Every change writes a `stock_movement` row in the same transaction.

Lifecycle: reserve at order placement → commit (decrement on-hand and reserved) when order is handed to rider (`OUT_FOR_DELIVERY`) → release on cancel/expiry/rejection. Failed delivery: staff choose restock or write-off (OPEN_DECISIONS C6).

### 5.3 Delivery-slot capacity
`delivery_slot_instance` rows (outlet, date, window, capacity, booked_count) are generated ahead from templates. Booking uses the same conditional-update pattern (`booked_count < capacity`) plus a `CHECK (booked_count <= capacity)`. Cancellation decrements. Slot lists shown to customers are computed live and also re-validated at placement.

### 5.4 Outlet selection
See APP_FLOW.md §2.3 for the full algorithm. Summary: filter outlets by active + serves area + not past cut-off + slot capacity + every line in stock; rank by configured zone priority, then earliest slot, then outlet code. The customer selects a time window; the API assigns the best eligible outlet for that window and retries the next candidate if a race is lost inside the transaction.

### 5.5 Order placement transaction
One transaction at `READ COMMITTED`; correctness under concurrency comes from the conditional updates and `CHECK` constraints, so no serializable retry loop is needed: re-price cart from DB → validate coupon → choose outlet → reserve stock → book slot → insert order + snapshot items + payment row + status event + audit → commit. Idempotency key from client (`Idempotency-Key` header) stored with a unique constraint so double-taps return the same order.

### 5.6 Payments
Adapter interface:

```ts
interface PaymentGateway {
  code: string;
  initiate(input: InitiateInput): Promise<{ redirectUrl: string; providerSessionId: string }>;
  verify(providerRef: string): Promise<VerifiedTransaction>;   // server-to-server status query
  parseCallback(req: RawRequest): Promise<CallbackClaim>;       // never trusted on its own
  refund?(input: RefundInput): Promise<RefundResult>;
}
```

The callback/IPN only tells us *which* transaction to check. Status is accepted only after a server-to-server verification call returns matching `order reference`, `amount`, `currency = BDT`, and a success status, and (where offered) the callback signature/hash validates. Each provider event is stored in `payment_event` with a unique `(provider, provider_event_id)` key so replays are no-ops. A reconciliation job re-verifies any payment stuck in `pending` after N minutes and before releasing holds.

### 5.7 Outlet scoping
Every outlet-owned table has `outlet_id`. A request-scoped `AccessContext` (user, roles, permitted outlet ids) is built by a guard. Repositories for outlet-owned data require an `AccessContext` and add `outlet_id IN (...)` to every query — no un-scoped repository method exists for staff routes. Lookups by id use `findFirst({ where: { id, outletId: { in: scope } } })`, returning 404 (not 403) for out-of-scope ids to avoid leaking existence. Integration tests assert this for every staff endpoint (QA_TEST_PLAN §4).

### 5.8 Notifications
Transactional outbox: business transaction inserts `notification_record` rows; a job sends them via provider adapters with exponential back-off (max attempts configurable), recording provider message ids and failures. Sending never blocks or rolls back an order.

### 5.9 Caching
Public catalogue responses: `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` plus Next.js ISR with on-demand revalidation when admins edit catalogue. Stock shown on listing pages is advisory and labelled; the cart and checkout always fetch live. All authenticated responses: `Cache-Control: private, no-store`.

## 6. Non-functional requirements

| Area | Target |
|------|--------|
| Storefront performance | LCP < 2.5 s and INP < 200 ms at p75 on a mid-range Android over 4G (Lighthouse mobile ≥ 85 on product pages). JS for product page < 170 KB gzipped. |
| API latency | p95 < 300 ms for catalogue reads, < 800 ms for order placement (excluding gateway). |
| Availability | 99.5 % monthly for storefront and API (managed hosting, ≥ 2 API instances, HA database). |
| Capacity (initial) | 50 concurrent shoppers, 500 orders/day, 20 staff users — design leaves headroom 10×. |
| Data durability | Managed backups + PITR + nightly off-site dump; RPO ≤ 5 min, RTO ≤ 4 h. |
| Browser support | Last 2 versions of Chrome/Android WebView, Safari iOS 15+, Samsung Internet, Firefox. |
| Accessibility | WCAG 2.2 AA. |
| Localisation | Bangla default, Asia/Dhaka time zone for all business times; timestamps stored in UTC. |

## 7. Environments

| Env | Purpose | Data | Payments |
|-----|---------|------|----------|
| local | Development via docker-compose (Postgres, MinIO, MailHog-style catcher) | Seeded TEST data | Fake gateway adapter |
| staging | Pre-production, same topology as prod | Seeded TEST data, never real customers | Gateway **sandbox** credentials |
| production | Live | Real | Live credentials after merchant approval |

Each environment has its own database, storage bucket, secrets and gateway credentials.

## 8. Integrations to be selected (see OPEN_DECISIONS)

- Payment gateway (E1) — adapter + sandbox implementation first; production adapter after documentation review and merchant approval.
- SMS provider (F2) — adapter with log-only implementation for dev.
- Object storage (H3), hosting (H1), DB (H2), monitoring (H5).

Selection criteria recorded per integration: official documentation currency, Bangladesh merchant eligibility, fees, settlement time, refund API support, webhook/IPN signing, sandbox quality, uptime history, support channel.

## 9. Operational constraints

- Single developer/team: favour boring, well-documented tools; avoid infrastructure that needs specialist operation.
- Costs must be approved by the business before provisioning (H6).
- Deploys must be possible without the developer's laptop (CI-driven).
- All schema changes via Prisma migrations, reviewed, backward-compatible within one release (expand → migrate → contract).
