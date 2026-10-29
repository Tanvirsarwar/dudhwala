> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Implementation Plan

Status: v0.1 — 2026-10-19. Updated at the end of every milestone.

## 1. Milestone overview

| # | Milestone | Depends on | Key deliverables | Exit gate |
|---|-----------|-----------|------------------|-----------|
| M1 | Discovery | — | Repo inspection, reference image analysis, sampled palette, open decisions list | ✅ Done 2026-10-19 |
| M2 | Requirements & design | M1 | All 12 docs; architecture + ERD; design tokens; wireframe-level page specs; provider shortlists with verified facts | ✅ Done 2026-10-19 (A1, B2, C5, H6 answered) |
| M3 | Foundation | M2 | Monorepo scaffold; CI; Prisma schema + migrations (incl. raw SQL constraints); auth (OTP, staff password, TOTP, sessions, CSRF); access module (roles, permissions, outlet scope guard); outlets; inventory core with movements; audit log; settings; job runner; `.env.example`; local docker-compose | ✅ Done 2026-10-19 (CI green `54ae07b`) |
| M4 | Storefront | M3 | Catalogue admin (minimal) + public catalogue API; Next.js storefront: home, category, search, product, cart (anon + logged-in, merge), area selection, OTP account, addresses; image pipeline; i18n bn/en; design system components | ✅ Done 2026-10-20/21 — axe clean; Lighthouse product page 78 (< 85 budget, see QA log) |
| M5 | Checkout & payments | M4 | Areas/zones/outlet rules; slot templates + generation; pricing + coupons; outlet selection; quote + place-order transaction; idempotency; payment adapter interface; fake gateway; sandbox adapter for chosen provider (after E1); webhook/verification; expiry + reconciliation jobs; COD eligibility; return page | ✅ Done — real gateway: SSLCOMMERZ adapter (sandbox/live by env), tested against a protocol mock; live credentials pending E1/E2 |
| M6 | Admin & delivery | M5 | Admin app: dashboards, orders board, transitions, picklists, rider assignment, inventory screens (receive/adjust/write-off/count/transfer), slots, zones, staff management, coupons, content, payments + refunds + reconciliation queue, COD handover, reports + CSV, audit viewer, settings; rider PWA; notifications outbox + SMS adapter | ✅ Done 2026-10-20/21 (incl. stock counts, transfers, hours, privacy, credential resets) |
| M7 | QA & security | M6 | Full test pass, ZAP baseline, dependency/secret scans, accessibility manual pass, Lighthouse + k6, failure simulations, security findings fixed, docs synced | ✅ Automated scope done 2026-10-21 (1 high + 4 medium found and fixed). ZAP, manual ASVS/pen test, manual TalkBack pass need staging |
| M8 | Deployment | M7 + H1–H6 approved | Staging environment, CI/CD deploys, domain + TLS, backups + restore test, monitoring/alerts, gateway sandbox → live, launch checklist, staff/rider guides | ◐ Repository side done (images, workflows, runbook, smoke + restore scripts, guides). Provisioning blocked on H1–H5, domain, merchant and SMS accounts |

After every milestone: lint → typecheck → tests → build → fix → update docs → milestone report (completed, remaining, actual test output).

## 2. M3 Foundation — task breakdown

1. Scaffold pnpm + Turborepo; `apps/api` (Nest), `apps/web`, `apps/admin` (Next), `packages/shared|ui|config`; strict TS; ESLint (incl. custom rules: route decorator required, no raw string SQL, no secret-like `NEXT_PUBLIC_*`).
2. docker-compose dev: Postgres 16, MinIO.
3. Prisma schema from DATABASE_SCHEMA.md; raw SQL migration for CHECKs, partial indexes, pg_trgm, grants on append-only tables.
4. `packages/shared`: money, phone, order/payment state machines, permission codes, zod DTOs — with unit tests first.
5. Auth module: OTP (log SMS adapter), sessions, staff login, argon2id, TOTP + recovery codes, CSRF, rate limiter.
6. Access module: guards, `AccessContext`, scoped repository base class.
7. Outlets module + hours + staff assignment.
8. Inventory module: receive/adjust/write-off/reserve/release/commit with movements; conditional-update SQL; concurrency integration test.
9. Audit + settings modules; job runner with SKIP LOCKED.
10. Seed scripts (dev/staging TEST data clearly labelled).
11. GitHub Actions CI.
12. Authz matrix test generator from route metadata.

## 3. Sequencing notes

- Pure logic (`packages/shared`) is test-first; it carries money and state rules used by every later milestone.
- The payment adapter and fake gateway are built before a provider is chosen, so M5 is not blocked by E1; the real adapter is a contained task once docs are verified.
- Admin screens needed for testing (create outlet, product, stock) get minimal versions in M3/M4; polished versions in M6.

## 4. Dependencies on the business

| Needed by | Items |
|-----------|-------|
| Start of M3 | A1 (name), B2 (per-outlet price?), C5 (multi-outlet staff), H6 (budget) |
| Start of M4 | A2 logo files, A4 fonts (or accept OFL defaults), A7 English scope, B1 initial catalogue sample (5–10 products with photos) |
| Start of M5 | D1–D5 areas/fees/slots for at least one outlet, E1 gateway choice, E4 COD rules, G1 coupon types |
| Start of M6 | C3, C4, C6, D6–D8, E5, F4 |
| Start of M8 | H1–H5, domain, all policies, merchant approval progress |

## 5. Estimates

Effort ranges assume one full-stack engineer with AI assistance; refined after M3.

| Milestone | Estimate |
|-----------|----------|
| M2 completion (review cycle) | 2–4 days (mostly waiting on decisions) |
| M3 | 1.5–2 weeks |
| M4 | 1.5–2 weeks |
| M5 | 2–3 weeks |
| M6 | 3–4 weeks |
| M7 | 1–1.5 weeks |
| M8 | 1 week + gateway approval lead time (external, can be weeks) |

Start merchant onboarding with the gateway early — it is usually the longest external dependency.

## 6. Launch checklist (full)

- [ ] OPEN_DECISIONS: all "Launch"-blocking items closed
- [ ] Brand: logo files installed, name spelling final, no unverified claims on site
- [ ] Content: about, FAQ, terms, privacy, refund, delivery, cancellation policies approved (bn, + en if in scope)
- [ ] Demo data removed: `pnpm --filter @dudhwala/api db:purge:demo` run on staging; no `DEMO-` SKUs, `demo-` slugs or `DEMO-1` outlet anywhere; demo image host removed from the storefront image allow-list
- [ ] Catalogue: products, photos, prices, variants approved by business (`content_approved_by` set)
- [ ] Outlets configured: hours, staff, MFA enrolled for managers and SA
- [ ] Areas, zones, outlet rules, fees, minimums, COD rules, slot templates configured and reviewed
- [ ] Inventory loaded and counted at each outlet; online buffers set
- [ ] Payment gateway: live credentials, IPN URL, test transaction + refund done; reconciliation owner named
- [ ] SMS sender approved; templates reviewed in Bangla
- [ ] Staging: all automated suites green on release SHA; manual exploratory pass
- [ ] Security: ZAP baseline on staging clean of high/critical; secrets audit; `pnpm audit` clean; external penetration test recommended
- [ ] Two Super Admins exist with two-factor enrolled; recovery codes stored offline
- [ ] `infra/ops/smoke.sh` passes against production URLs
- [ ] SSLCOMMERZ `verify_sign` scheme confirmed with SSLCOMMERZ
- [ ] Error tracking/alerting provider wired (H5)
- [ ] Performance budgets met
- [ ] Backups verified; restore test recorded
- [ ] Monitoring alerts fired in test and received by named people
- [ ] Rollback rehearsed on staging
- [ ] Staff and rider training done; operating guides distributed
- [ ] Support phone/WhatsApp contact on site staffed during launch hours
- [ ] Go/no-go meeting with business

## 7. Progress log

| Date | Milestone | Completed | Remaining | Test status |
|------|-----------|-----------|-----------|-------------|
| 2026-10-21 | **M4–M7 complete; M8 repository side complete** | (Earlier session, 2026-10-20: public catalogue, cart, accounts, content/media, delivery config, checkout transaction, payment simulator, order operations, rider flow, COD, reports, notifications, storefront and admin apps, 17 E2E scenarios.) This session: SSLCOMMERZ adapter, HTTP SMS adapter, outlet hours/closures, stock counts, transfers, privacy export/deletion, maintenance mode, staff password/2FA resets + break-glass CLI, rate limits on coupon/checkout/payment, UTC DB sessions fix, atomic idempotency fix, E2E in CI, container images + release workflow, smoke and restore scripts, operations and payment guides, docs synced | Business inputs (OPEN_DECISIONS), hosting/domain/merchant/SMS accounts, staging provisioning, ZAP + manual security review, product-page performance tuning, error tracking | api 237/237, shared 76/76, E2E 21/21, builds ✅ — see QA log |
| 2026-10-19 | **M3 complete** (CI ✅ `54ae07b`) | Migration 0002; DB-backed TOTP replay guard; shared per-IP rate limiter; typed settings with safe defaults (global + outlet); PostgreSQL job queue (SKIP LOCKED, retries with back-off, stale-lock recovery) + hourly maintenance cleanup; minimal catalogue admin with publish/approval and audited price changes; `create-super-admin` CLI; 156 API integration tests | Carried to M4: dev seed data (TEST-labelled), image upload pipeline. Carried to M6: notification outbox/SMS sending | See QA results log |
| 2026-10-19 | M3 (in progress) | NestJS API: env validation, request ids, uniform errors, security headers, CORS allow-list, signed double-submit CSRF + Origin check, fail-closed AccessGuard (public / customer / staff / permission), outlet scoping helpers; auth (phone OTP with limits, staff argon2id login with lockout, TOTP MFA + enrolment + recovery codes, sessions with absolute/idle expiry and revocation); outlets + staff assignment; inventory (receive/adjust/write-off/settings/movements; concurrency-safe reserve); audit service; system seed (roles, permissions); health; 142 integration tests | Per-IP rate limiter, DB-backed TOTP replay guard, settings module, job runner, catalogue admin minimal, CLI to create first Super Admin, commit `0001_init` from first CI run | See QA results log |
| 2026-10-19 | Hosting decision | Managed PaaS + managed HA PostgreSQL (cost not a constraint); runbook/TRD/open decisions updated | Pick provider with business before M8 | — |
| 2026-10-19 | M3 (in progress) | Monorepo (pnpm workspaces), `packages/shared` (money, phone, order + payment state machines, pricing/coupons/COD, inventory math, outlet selection, permissions) with tests; Prisma 7 schema (all entities) + `constraints.sql`; `.env.example`; dev docker-compose; CI workflow | NestJS API scaffold, auth (OTP, staff + TOTP, sessions, CSRF, rate limits), access guards + scoped repositories, outlets/inventory/audit/settings modules, job runner, seeds, authz matrix harness; first CI run to generate + verify `0001_init` | See QA results log |
| 2026-10-19 | M2 decisions | A1 Dudhwala, B2 single price, C5 one outlet per staff, H6 budget → single-VPS topology; docs updated | Remaining open decisions per OPEN_DECISIONS | Docs only |
| 2026-10-19 | M1 | Workspace inspected (empty, no existing repo/code/assets beyond the brief and reference image); reference image analysed; palette sampled and contrast-checked; 12 docs drafted | Business review of docs and answers to blocking decisions; provider fact-checks (E1, H1–H5) | No code yet — nothing to run |
