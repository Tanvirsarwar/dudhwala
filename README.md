# Dudhwala — Official E-commerce Platform

Online ordering, payment (online gateway + cash on delivery) and multi-outlet home-delivery operations for **Dudhwala Food Products** (দুধওয়ালা), Sylhet.

**Status (2026-10-21):** Milestones 1–7 complete; Milestone 8 complete on the repository side. The platform runs end to end with the payment simulator and demo data. A controlled production launch needs the business inputs in [OPEN_DECISIONS](docs/OPEN_DECISIONS.md), a hosting account, a domain, a payment-gateway merchant account and an SMS provider ([launch checklist](docs/IMPLEMENTATION_PLAN.md#6-launch-checklist-full)).

## What is in the box

| App | Path | Purpose |
|---|---|---|
| API | `apps/api` | NestJS + Prisma 7 + PostgreSQL. Auth (phone OTP, staff password + TOTP), outlet-scoped access control, catalogue, cart, checkout, payments (simulator, SSLCOMMERZ), inventory, delivery, rider, COD, reports, audit, jobs. |
| Storefront | `apps/web` | Next.js, Bangla-first, mobile-first shop: home, categories, search, product, cart, checkout, order tracking, account, privacy controls. |
| Admin + rider | `apps/admin` | Next.js admin for Super Admin, outlet managers and staff; phone screen for riders. |
| Shared | `packages/shared` | Money (integer poisha), phone numbers, order and payment state machines, pricing/coupons/COD rules, outlet selection, permissions. |
| E2E | `e2e` | Playwright tests against the full stack (`e2e/stack.sh`). |
| Infra | `infra` | Dockerfiles, dev compose file, smoke test (`infra/ops/smoke.sh`), restore check (`infra/ops/verify-restore.sql`). |

## Quick start (local)

```bash
corepack enable && pnpm install && pnpm prepare:codegen
cp .env.example apps/api/.env               # fill DATABASE_URL and the three secrets
pnpm --filter @dudhwala/api db:migrate:dev
pnpm --filter @dudhwala/api db:seed:demo    # optional demo data (labelled DEMO)
SUPER_ADMIN_PASSWORD='a-long-password' pnpm --filter @dudhwala/api cli:create-super-admin:dev -- --email you@example.com --name "Your Name"
pnpm --filter @dudhwala/api dev & pnpm --filter @dudhwala/web dev & pnpm --filter @dudhwala/admin dev
```

Shop http://localhost:3000 · Admin http://localhost:3001 · API http://localhost:4000/v1. Full instructions: [DEPLOYMENT_RUNBOOK §2](docs/DEPLOYMENT_RUNBOOK.md#2-local-development).

## Prerequisites

- Node.js 22+ (see `.nvmrc`), pnpm 9.15 (`corepack enable`)
- PostgreSQL 16+ with the `citext` and `pg_trgm` extensions (created by migration `0001_init`)
- For E2E only: Playwright browsers (`pnpm --filter e2e exec playwright install chromium`) and `fuser`/`psql` on PATH

## Environment configuration

Copy `.env.example` to `apps/api/.env` and fill in the blank secrets (`openssl rand -base64 32` for each). The storefront and admin read `NEXT_PUBLIC_*` variables at build time. Real `.env` files are git-ignored; never commit credentials. Staging/production values belong in the host's secret store.

## Database migrations

```bash
pnpm --filter @dudhwala/api db:migrate:dev      # local: apply and create migrations
pnpm --filter @dudhwala/api db:migrate:deploy   # staging/production: apply committed migrations only
```

Migrations live in `apps/api/prisma/migrations`. Hand-written constraints are in `apps/api/prisma/sql/constraints.sql` and are included in the migrations.

## Build and checks

```bash
pnpm prepare:codegen   # builds packages/shared, generates Prisma client (required before lint/typecheck/build)
pnpm lint && pnpm typecheck
pnpm build             # shared, API, storefront, admin
```

## Testing

```bash
pnpm --filter @dudhwala/shared test             # unit tests, no database needed
# API integration tests need a PostgreSQL server; they create and drop their own databases
export TEST_ADMIN_DATABASE_URL=postgresql://USER:PASS@localhost:5432/postgres
export DATABASE_URL=postgresql://USER:PASS@localhost:5432/dudhwala_ci
pnpm --filter @dudhwala/api db:migrate:deploy
pnpm --filter @dudhwala/api test
# E2E (Playwright): see e2e/stack.sh and e2e/package.json
```

## Catalogue management

Admin → পণ্য ও দাম: create/edit products and variants, upload product photos, publish, archive. **CSV নামান** exports every variant (SKU, price, compare-at); **CSV থেকে দাম** uploads the edited file, shows a preview and applies it only if every row is valid (all-or-nothing, audited). Needs the `catalog.manage` and `pricing.manage_global` permissions. Product photos must come from the business or be properly licensed; the demo seed's third-party photos are for private demos only.

See [docs/AUDIT_2026-10-26.md](docs/AUDIT_2026-10-26.md) for the latest audit, the image-loading root cause and the UI changes.

## Verified results (2026-10-21)

| Check | Result |
|---|---|
| Lint, type check (all packages) | 0 errors |
| Unit tests (`packages/shared`) | 76/76 |
| API integration tests (real PostgreSQL 16) | 237/237 |
| End-to-end (Playwright: mobile + desktop storefront, admin, rider, axe accessibility) | 21/21 |
| Production builds (API, storefront, admin) | pass; container images built in GitHub Actions |
| `pnpm audit` | no known vulnerabilities |
| Lighthouse mobile (local) | home 97 performance / 100 accessibility; product page 78 performance (below the 85 budget — re-measure on staging) |

GitHub Actions on `a6ef3c8`: CI, E2E and Images all green. Details and history: [QA_TEST_PLAN §9](docs/QA_TEST_PLAN.md#9-results-log). CI runs lint, type check, migrations, tests and builds on every push; E2E and image builds run on every push to `main`.

## Deliverables map (brief §18)

| # | Deliverable | Where |
|---|---|---|
| 1–2 | Frontend and backend source | `apps/web`, `apps/admin`, `apps/api`, `packages/shared` |
| 3 | PostgreSQL schema and Prisma migrations | `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations`, [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) |
| 4 | Outlet-aware inventory and fulfilment | inventory, stock counts, transfers, outlet selection (`packages/shared/src/fulfilment.ts`, `apps/api/src/checkout`) |
| 5 | Authentication and role-based permissions | `apps/api/src/auth`, `apps/api/src/access`, [USER_ROLES_AND_PERMISSIONS](docs/USER_ROLES_AND_PERMISSIONS.md) |
| 6 | Storefront and checkout | `apps/web`, `apps/api/src/checkout` |
| 7 | Online payment integration | simulator + SSLCOMMERZ adapter (`apps/api/src/payments`), [PAYMENT_GATEWAY_GUIDE](docs/PAYMENT_GATEWAY_GUIDE.md) |
| 8 | Cash on delivery | eligibility rules, rider collection, manager handover, discrepancy resolution |
| 9 | Multi-outlet admin dashboard | `apps/admin` |
| 10 | Outlet delivery operations | areas, zones, outlet rules, slots, hours, closures, rider app |
| 11 | Reports and audit logs | admin **রিপোর্ট** (CSV) and **অডিট লগ** |
| 12 | Automated tests | `packages/shared/src/*.test.ts`, `apps/api/test`, `e2e/tests` |
| 13 | Documentation | [docs/](docs) (list below) |
| 14 | `.env.example` | [.env.example](.env.example) |
| 15–17 | Local, staging, production instructions | [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) §2, §4 |
| 18 | Domain and HTTPS/TLS guide | DEPLOYMENT_RUNBOOK §5–6 |
| 19 | Backup and restoration guide | DEPLOYMENT_RUNBOOK §8, `infra/ops/verify-restore.sql` |
| 20 | Payment gateway onboarding and reconciliation | [PAYMENT_GATEWAY_GUIDE](docs/PAYMENT_GATEWAY_GUIDE.md) |
| 21 | Staff and delivery operating instructions | [OPERATIONS_GUIDE](docs/OPERATIONS_GUIDE.md) |
| 22 | Launch checklist | [IMPLEMENTATION_PLAN §6](docs/IMPLEMENTATION_PLAN.md#6-launch-checklist-full) |
| 23 | Known limitations and open decisions | below and [OPEN_DECISIONS](docs/OPEN_DECISIONS.md) |
| 24 | Test results and build status | above and [QA_TEST_PLAN §9](docs/QA_TEST_PLAN.md#9-results-log) |

## Known limitations

- **No real business content yet**: catalogue, prices, outlets, delivery areas, fees, slots, hours and policies must be entered by the business. Demo data (third-party bakery photos and prices) is for private demos only and must be purged before launch.
- **Logo**: only a 450×240 raster crop exists; an SVG or transparent PNG is needed (OPEN_DECISIONS A2).
- **Payments**: the SSLCOMMERZ adapter is tested against a protocol mock, not against SSLCOMMERZ's live sandbox (needs a store account). Its IPN signature scheme must be confirmed with SSLCOMMERZ (safety does not depend on it).
- **SMS**: generic HTTP adapter; parameter mapping must be set for the chosen provider and tested with a real phone.
- **Not yet done (need staging)**: OWASP ZAP scan, manual ASVS review / penetration test, TalkBack screen-reader pass, staging performance measurement, restore test on the managed database.
- **Product page performance**: Lighthouse 78 locally (budget 85); tune fonts/CSS and re-measure with the real image CDN.
- **Not built (out of v1 scope)**: subscriptions/recurring milk delivery, English UI, map-pin addresses, split orders, courier integrations, proof-of-delivery photos, POS integration for walk-in sales (use the per-product online buffer and stock counts), error-tracking integration, key-rotation script for `DATA_ENCRYPTION_KEY`.
- **Legal**: data-retention periods and policy texts need a lawyer's confirmation (OPEN_DECISIONS F6, A6).

## Documentation

| Doc | Purpose |
|---|---|
| [PRD](docs/PRD.md) | Goals, scope, requirements, acceptance criteria |
| [TRD](docs/TRD.md) | Architecture, technology, key technical designs |
| [APP_FLOW](docs/APP_FLOW.md) | Customer, outlet, admin and rider journeys; exception flows; outlet selection |
| [UI_UX_SPEC](docs/UI_UX_SPEC.md) | Sampled brand palette, tokens, typography, components, accessibility |
| [DATABASE_SCHEMA](docs/DATABASE_SCHEMA.md) | ERD, tables, constraints, concurrency and isolation |
| [API_SPECIFICATION](docs/API_SPECIFICATION.md) · [API_ROUTES](docs/API_ROUTES.md) | Conventions and contracts · generated list of every route and its access rule |
| [USER_ROLES_AND_PERMISSIONS](docs/USER_ROLES_AND_PERMISSIONS.md) | Roles, permission matrix, data boundaries |
| [SECURITY_REVIEW](docs/SECURITY_REVIEW.md) | Threats, controls, test status, findings log |
| [QA_TEST_PLAN](docs/QA_TEST_PLAN.md) | Test plan, coverage map, results log |
| [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) | Environments, CI/CD, DNS/TLS, migrations, backups, monitoring, rollback |
| [PAYMENT_GATEWAY_GUIDE](docs/PAYMENT_GATEWAY_GUIDE.md) | Gateway onboarding, reconciliation, refunds |
| [OPERATIONS_GUIDE](docs/OPERATIONS_GUIDE.md) | Day-to-day instructions for staff, riders and Super Admin |
| [IMPLEMENTATION_PLAN](docs/IMPLEMENTATION_PLAN.md) | Milestones, launch checklist, progress log |
| [OPEN_DECISIONS](docs/OPEN_DECISIONS.md) | Everything the business still has to decide |

Brand reference: `assets/reference/opening-invitation.png`; logo raster: `assets/brand/logo-lockup-from-invitation.png`.
