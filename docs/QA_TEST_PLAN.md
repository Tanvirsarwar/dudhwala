> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# QA Test Plan

Status: Draft v0.1 — 2026-10-19

Rule: results are reported only from actual runs. Each milestone report attaches the CI run link or command output summary. "Not run" is a valid, honest status.

## 1. Test levels and tools

| Level | Tool | Where | Runs |
|-------|------|-------|------|
| Static | ESLint, `tsc --noEmit`, Prettier check | all packages | every push |
| Unit | Jest (`packages/shared`, `apps/api` services with fakes) | CI | every push |
| Integration | Jest + real PostgreSQL 16 (docker service in CI), Nest testing module, supertest | CI | every push |
| E2E | Playwright (Chromium mobile emulation Pixel 7 + desktop Chrome; WebKit iPhone 13 smoke) against docker-compose stack with fake gateway | CI | PRs to main + nightly |
| Accessibility | @axe-core/playwright on key pages; manual TalkBack pass | CI + manual pre-launch | per milestone |
| Performance | Lighthouse CI (mobile) on home, category, product; k6 load test on checkout | staging | M7, pre-launch |
| Security | authz matrix tests, ZAP baseline, gitleaks, dependency audit | CI / staging | per push / weekly |

Test data: factories in `apps/api/test/factories`; every test creates its own outlets, products and users; DB truncated between integration suites. Time controlled by an injectable clock.

## 2. Unit tests (minimum cases)

| Area | Cases |
|------|-------|
| Money | add/subtract/multiply ints; percentage in basis points rounding (half-up) at boundaries; negative guard; formatting `bn-BD` with ৳ and Bangla digits |
| Price calculation | subtotal from lines; outlet price override applied; zero/empty cart |
| Discount | percent with cap; fixed > subtotal clamps to subtotal; free-delivery coupon; min order not met; expired/not-started; outlet-restricted; per-customer limit reached; first-order-only |
| Delivery fee | flat fee; free above threshold (exactly at threshold, one poisha below); no rule → not serviceable |
| COD eligibility | disabled zone; max order value boundary; outlet flag; customer failed-delivery block |
| Outlet eligibility/selection | inactive outlet excluded; area not served; one line missing; stock exactly equal; min order; cut-off just passed/just before; full slot; priority ordering; tie-break by code; "no single outlet" detection with per-line availability elsewhere |
| Order state machine | every allowed transition passes; every disallowed transition rejected; terminal states immutable |
| Payment state machine | as above; PAID → REFUNDED only via refunds; partial refunds sum |
| Inventory math | available = on_hand − reserved; reserve/release/commit/restock deltas; cannot go negative |
| Phone normalisation | `01712345678`, `+8801712345678`, `8801712345678`, Bangla digits `০১৭…`, invalid prefixes |
| Slot generation | templates → instances across weekdays, closures skipped, DST-free Asia/Dhaka, cut-off computation |

## 3. Integration tests

| Area | Cases |
|------|-------|
| Inventory reservation | 20 parallel placements for the last 5 units → exactly 5 succeed, rest `OUT_OF_STOCK`; on_hand/reserved consistent; movements count matches |
| Slot capacity | capacity 3, 10 parallel placements → 3 succeed; `booked_count` = 3; cancellation frees one |
| Order transaction atomicity | failure injected after stock reserve (e.g. slot full) → no reservation persists |
| Checkout pricing | client-sent price/total fields ignored or rejected; `PRICE_CHANGED` when price edited between quote and place |
| Idempotency | same key twice → one order; same key different body → 409 |
| Outlet isolation | see §4 |
| Auth | OTP lifecycle, expiry, attempt limit, rate limits; staff login lockout; MFA required for manager routes; session revocation on role change |
| Payment initiation | amount from DB; cannot initiate for expired/other user's order |
| Webhook verification | valid flow → PAID; replayed event → no change; bad signature → stored, rejected, alert; verification returns different amount → not paid, exception logged; currency ≠ BDT → rejected; unknown tran id → stored unmatched |
| Delayed callback | callback after hold expiry → paid-after-expiry path (re-reserve or cancel + refund task) |
| Reconciliation job | stuck PENDING re-verified; expired holds released exactly once (job run twice concurrently) |
| COD | collected = expected → COLLECTED; mismatch → DISCREPANCY; handover → order PAID; rider cannot confirm own handover |
| Refunds | cannot exceed paid; partial then full; idempotent |
| Notifications | outbox rows created in order transaction; provider failure retried with back-off; max attempts → FAILED; order unaffected |
| Audit | each audited action writes one entry with actor and outlet |
| Stock transfer | approve/dispatch/receive movements; partial receive difference recorded |

## 4. Security & authorization matrix (integration)

Automatically generated from the route registry: for every `/admin/outlets/:outletId/**` and `/rider/**` route, tests run as:

1. Unauthenticated → 401.
2. Customer session → 403/404.
3. Staff of Outlet B targeting Outlet A path → 404.
4. Staff of Outlet A with Outlet A path but **resource id** belonging to Outlet B (manipulated id) → 404.
5. Role lacking permission → 403.
6. Rider requesting another rider's delivery → 404; rider after grace window → contact fields absent.
7. Customer A requesting Customer B order/address → 404.

Plus: CSRF missing/invalid → 403; CORS from unknown origin → no ACAO header; webhook with forged body; rate-limit enforcement (429 + Retry-After); responses checked for absence of `password_hash`, `token_hash`, `mfa_totp_secret`, raw gateway credentials; log capture asserts phone numbers are masked.

## 5. End-to-end scenarios (Playwright)

| # | Scenario | Expected |
|---|----------|----------|
| E1 | Guest browses, sets area, adds 2 products, OTP verify, COD checkout | Order PLACED, UNPAID; confirmation page; appears on Outlet board |
| E2 | Online payment success (fake gateway) | Return page shows verifying → confirmed; payment PAID only after webhook verification |
| E3 | Online payment failure | Order PENDING_PAYMENT, retry offered; after retry success → PAID |
| E4 | Delayed callback | Return page times out gracefully; webhook arrives later → order updates; SMS outbox row |
| E5 | Duplicate webhook | Second delivery no-op; one status event |
| E6 | Browser hits success URL with forged params | Not paid |
| E7 | Unserviceable area | Clear message, served areas listed, cannot proceed |
| E8 | Full slot | Slot shown disabled "পূর্ণ"; race: slot fills during checkout → SLOT_FULL message |
| E9 | Out-of-stock product | Disabled add button; stock removed after add → checkout shows blocking line |
| E10 | No single outlet can fulfil | Explanatory message; lines marked; no split order created |
| E11 | Customer cancels before confirmation | Stock and slot released; online → refund task |
| E12 | Outlet flow: confirm → prepare → ready → assign rider → dispatch | Stock committed at dispatch |
| E13 | Rider failed delivery → reschedule → delivered with COD | Attempts recorded; COD collected, manager handover → PAID |
| E14 | Outlet A manager tries Outlet B URL | 404 page, no data |
| E15 | Rider permissions | Sees only own deliveries; no admin navigation |
| E16 | Customer order privacy | Customer B cannot open Customer A tracking URL |
| E17 | Reorder with price change | Cart uses current prices with notice |
| E18 | Super Admin consolidated report + CSV export | Export audited |

## 6. Accessibility

axe: zero serious/critical violations on home, category, product, cart, checkout steps, order tracking, login, admin orders list, rider delivery page. Manual: keyboard-only checkout; TalkBack checkout on Android; 200 % zoom; reduced motion.

## 7. Performance

- Lighthouse CI budgets (mobile): Performance ≥ 85, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤ 200 ms on product page.
- k6: 50 virtual users browsing + 5 placements/s for 10 min on staging; p95 placement < 800 ms; zero oversell; zero 5xx.

## 8. Operational failure simulations (M7)

DB restart during checkout; gateway sandbox timeout; SMS provider down; job runner killed mid-batch; clock skew; deploy rollback rehearsal; backup restore to scratch DB and row-count verification.

## 9a. Coverage map (2026-10-21)

Where each planned scenario is tested. "API" = Vitest + supertest against real PostgreSQL (`apps/api/test`); "E2E" = Playwright in a real browser against the full stack (`e2e/tests`).

| # | Scenario | Covered by |
|---|---|---|
| E1 | COD checkout | E2E `COD checkout: area, cart, OTP login, address, slot, place order, track, cancel` (mobile + desktop); API `places a COD order…` |
| E2 | Online payment success | E2E `online payment via the simulator: success URL alone never pays; verified IPN does`; API `marks PAID only after the server-side verification…`; SSLCOMMERZ adapter: API `pays only after the transaction query confirms VALID, amount and BDT` |
| E3 | Online payment failure + retry | E2E `a failed online payment offers retry or cash on delivery`; API `never trusts the success URL; a failed payment can be retried` |
| E4 | Delayed callback | API `a payment that completes just before expiry is caught by the final gateway check`, `paid after expiry: re-reserves when possible, otherwise requests a refund` |
| E5 | Duplicate webhook | API `ignores duplicate IPNs and rejects forged ones`; SSLCOMMERZ replay test |
| E6 | Forged success URL | E2E online payment test (return page alone never pays); API forged IPN tests |
| E7 | Unserviceable area | API `refuses unserviceable areas and validates minimum order and COD limits` |
| E8 | Full slot | API `never overbooks a slot: capacity 2, 6 orders for the same window`, `respects slot cut-off times` |
| E9 | Out-of-stock | E2E `search, product page and out-of-stock handling`; API `never oversells: 8 customers race for 3 units` |
| E10 | No single outlet | API `explains when no single outlet can fulfil the whole cart`, `falls over to the next outlet…` |
| E11 | Customer cancellation | E2E COD test (cancel step); API `customer cancellation releases stock, slot and notifies…` |
| E12 | Outlet flow | E2E `the outlet manager confirms, prepares, assigns a rider and dispatches`; API `runs the full COD lifecycle…` |
| E13 | Failed delivery → reschedule / COD handover | API `handles failed delivery…`, `records COD discrepancies…`; E2E rider + cash handover steps |
| E14 | Outlet isolation | API 98-case authorization matrix + `outlet A staff cannot see or act on outlet B orders, riders, COD, slots or reports`; stock counts / transfers / hours scope tests |
| E15 | Rider permissions | E2E rider redirected away from order board; API `riders see only their own active deliveries; contact details vanish after the grace period` |
| E16 | Customer order privacy | E2E `a customer cannot open someone else’s order`; API account/address/order 404 tests |
| E17 | Reorder with current prices | API `reorder adds still-available items at current prices` |
| E18 | Reports + CSV audited | API `reports are outlet-scoped; CSV needs permission, is audited and formula-safe` |
| — | Stock count, transfers, hours, privacy, maintenance, credentials | API `m7-operations.test.ts`; E2E stock count, hours, privacy scenarios |
| — | Accessibility (axe, WCAG 2.1 AA, serious/critical = 0) | E2E on home, cart, checkout, confirmation, account/privacy, admin stock count, hours, privacy, rider |

## 9. Results log

| Date | Milestone | Lint | Types | Unit | Integration | E2E | Build | Notes |
|------|-----------|------|-------|------|-------------|-----|-------|-------|
| 2026-10-21 | M4–M8 final (sandbox, PostgreSQL 16 with server TimeZone Asia/Dhaka for tests) | ✅ 0 errors (shared, api, web, admin) | ✅ 0 errors (shared, api, web, admin, e2e) | ✅ shared 76/76 | ✅ api 237/237 (12 files), 3 consecutive full runs green after the idempotency fix | ✅ 21/21 Playwright (Chromium; Pixel 7 + desktop storefront, admin, rider; axe gates) on a fresh database | ✅ shared, api, web, admin production builds | Found and fixed in this pass: (1) DB session timezone bug (app-written timestamps 6 h off on a non-UTC server) — regression test added; (2) flaky 500 on double-tapped checkout (non-atomic idempotency claim) — fixed, repeated runs green; (3) E2E flake from Next.js data cache across fresh databases — stack script clears it. Lighthouse (mobile, simulated slow 4G, local): home Performance 97 / Accessibility 100 / Best practices 93, LCP 2.4 s, CLS 0.009; product page Performance **78** (budget 85 not met), LCP 4.4 s — render-blocking CSS ~0.7 s and 7 font files; product photo host blocked in this sandbox. Re-measure on staging with the real CDN. Load (single API instance, autocannon 50 connections, 20 s): catalogue API ~230 req/s, p97.5 318–367 ms; product page ~150–170 req/s, p97.5 608–686 ms; 0 non-2xx and 0 errors (two runs). `pnpm audit`: no known vulnerabilities. `infra/ops/verify-restore.sql` on the E2E database: all integrity checks 0. GitHub Actions on `a6ef3c8`: CI ✅ (lint, typecheck, migrate deploy 0001–0004, drift checks, 76 + 237 tests, builds), E2E ✅ (21/21), Images ✅ (api, api-migrate, web, admin built). |
| 2026-10-19 | M3 complete (sandbox, real migrations 0001+0002 applied as SQL) | ✅ | ✅ | ✅ shared 76/76 | ✅ api 156/156 (adds: per-IP limits incl. across 2 instances, cross-instance TOTP replay, settings scope/validation/audit, job queue retries/permanent failure/no double-run across 2 instances/stale lock, maintenance cleanup, catalogue publish/approval/price audit, CLI); also 156/156 on the dev-ddl fallback | not run | ✅ + CLI smoke-tested | GitHub Actions on `54ae07b`: ✅ all steps (migrate deploy 0001+0002, migrations-vs-schema drift check, dev-ddl drift check, lint, typecheck, tests, build) |
| 2026-10-19 | M3 foundation (GitHub Actions, run on `3db9690`) | ✅ | ✅ | ✅ shared 76/76 | ✅ api 142/142 on PostgreSQL 16 service container | not run — no front-end yet | ✅ | First CI run: initial migration generated by Prisma's native engine and applied cleanly with all `constraints.sql` rules; dev bootstrap DDL drift report **empty** (matches Prisma output exactly). `0001_init` committed. |
| 2026-10-19 | M3 foundation (sandbox) | ✅ eslint clean (shared, api) | ✅ `tsc --noEmit` clean (shared, api) | ✅ shared 76/76; api unit (TOTP RFC 4226 vectors, AES-GCM) included below | ✅ api 142/142 against real PostgreSQL 16: OTP flow + limits, CSRF/origin, staff login lockout, MFA (TOTP, enrolment, recovery codes, replay), idle expiry, deactivation cut-off, 98-case outlet authorization matrix, inventory movements/audit, 20-way concurrent reservation (no oversell), all-or-nothing reservation, optimistic locking, append-only triggers, CHECK constraints | not run — no front-end yet | ✅ shared + api build; compiled server smoke-tested (`/health`, security headers, 401 on admin route) | Schema in sandbox tests comes from `scripts/dev-ddl.mjs` (DMMF bootstrap) + `constraints.sql`, because Prisma's native engine download is blocked here. Real `0001_init` migration is generated by CI, which also checks the bootstrap for drift — **CI not yet run**. |
| 2026-10-19 | M3 start (sandbox) | ✅ eslint clean (`packages/shared`) | ✅ `tsc --noEmit` clean | ✅ 76/76 passed, 100 % lines, 98.11 % branches | not run — no API yet | not run | ✅ `packages/shared` builds; ✅ `prisma validate` passes | Prisma native schema engine could not be downloaded in the sandbox (binaries host blocked), so migration SQL generation and `constraints.sql` application were **not executed**. CI `database` job does both; result pending first CI run. |
| 2026-10-19 | M1–M2 (docs) | not run — no code yet | not run | not run | not run | not run | not run | Documentation only |
