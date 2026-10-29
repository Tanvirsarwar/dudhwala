> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Deployment Runbook

Status: v1.0 — 2026-10-21. Everything here is implemented in the repository and was exercised locally and in GitHub Actions, except steps that need a hosting account, domain, gateway merchant account or SMS provider (marked **[needs account]**). The hosting provider is still to be chosen with the business (OPEN_DECISIONS H1); the steps are provider-neutral because the deliverables are standard container images.

## 1. Environments and components

| Component | Image / command | local | staging | production |
|---|---|---|---|---|
| API (NestJS) | `dudhwala-api` (`infra/docker/api.Dockerfile`) | `pnpm --filter @dudhwala/api dev` :4000 | `api.staging.<domain>` | `api.<domain>` (≥ 2 instances) |
| Migration step | `dudhwala-api-migrate` (target `migrate`) | `prisma migrate dev` | run once per release | run once per release |
| Storefront (Next.js) | `dudhwala-web` (`infra/docker/next.Dockerfile`, `APP=web`) | `pnpm --filter @dudhwala/web dev` :3000 | `staging.<domain>` | `<domain>` (`www` → redirect) |
| Admin + rider (Next.js) | `dudhwala-admin` (`APP=admin`) | `pnpm --filter @dudhwala/admin dev` :3001 | `admin.staging.<domain>` | `admin.<domain>` |
| PostgreSQL 16+ | managed | docker or local server | managed, small | managed, HA standby, PITR |
| Object storage | S3-compatible + CDN | local disk (`MEDIA_STORAGE=local`) | bucket `dw-staging-media` | bucket `dw-prod-media` |
| Payments | `PAYMENTS_PROVIDER` | `fake` simulator | SSLCOMMERZ sandbox (or simulator with `ALLOW_PAYMENT_SIMULATOR=true`) | SSLCOMMERZ live |
| SMS | `SMS_PROVIDER` | `log` | `http` (provider test account) | `http` |

Background jobs (payment reconciliation, hold expiry, slot generation, SMS outbox, cleanup) run inside every API instance; PostgreSQL row locks (`FOR UPDATE SKIP LOCKED`) ensure each job runs once. Rate-limit counters and TOTP replay guards are also in PostgreSQL, so any number of API instances is safe. No Redis is needed.

### 1.1 Hosting topology (decision 2026-10-19)

Priority is low operational risk; cost is not the deciding factor. **[needs account]**

| Item | Requirement |
|---|---|
| App hosting | Managed container platform running the three images; zero-downtime deploys; automatic restarts; health checks (`GET /v1/health/live`, readiness `GET /v1/health/ready`); ≥ 2 API instances in production; Singapore (or nearest) region. |
| Release step | The platform's "pre-deploy/release command" (or a one-off job) runs the `dudhwala-api-migrate` image before new API instances take traffic. |
| Database | Managed PostgreSQL 16+: automated daily backups, point-in-time recovery ≥ 7 days, HA standby in production, encryption at rest, private network to the app, TLS required. |
| Staging | Separate project with its own smaller database, secrets and bucket. |
| Object storage | S3-compatible bucket + CDN; versioning on. |
| Off-site backup | Nightly `pg_dump` to a bucket in a different provider/account. |
| TLS / DNS | Platform-managed certificates; DNS with registrar 2FA. |
| Monitoring | Uptime checks + platform metrics/alerts + log retention ≥ 30 days. |

Candidates to evaluate with the business (verify current pricing and features on their official sites before choosing): DigitalOcean App Platform + Managed PostgreSQL, Render, Railway, Fly.io + a managed Postgres, AWS (App Runner/ECS + RDS). All run these images unchanged.

## 2. Local development

Prerequisites: Node.js 22 (`.nvmrc`), pnpm 9 (`corepack enable`), PostgreSQL 16 (local server or `docker compose -f infra/docker-compose.dev.yml up -d postgres`).

```bash
git clone https://github.com/tan-vir00/dudhwala && cd dudhwala
corepack enable
pnpm install
pnpm prepare:codegen                       # builds packages/shared and generates the Prisma client
cp .env.example apps/api/.env              # fill the API block; generate secrets with: openssl rand -base64 32
pnpm --filter @dudhwala/api db:migrate:dev # applies prisma/migrations to DATABASE_URL
pnpm --filter @dudhwala/api db:seed:demo   # optional: demo catalogue, outlet, areas, slots (labelled DEMO)
pnpm --filter @dudhwala/api dev            # API  http://localhost:4000/v1
pnpm --filter @dudhwala/web dev            # shop http://localhost:3000
pnpm --filter @dudhwala/admin dev          # admin http://localhost:3001
```

Create the first Super Admin (§2.2), then log in at http://localhost:3001.

Checks before pushing (CI runs the same):

```bash
pnpm lint && pnpm typecheck
TEST_ADMIN_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/postgres pnpm test   # drops/recreates dudhwala_test — never a shared server
pnpm build
```

End-to-end (browser) tests: create `apps/api/.env` with `ENABLE_DEV_OUTBOX=true`, then
`PSQL_ADMIN_URL=postgresql://…/postgres bash e2e/stack.sh --fresh-db` and `cd e2e && pnpm exec playwright test`.

### 2.1 Demo data (local and staging only)

`db:seed:demo` loads 14 demo cakes (names, prices and hot-linked image URLs from a third-party bakery listing, all labelled DEMO), a `DEMO-1` outlet with stock, three demo Sylhet areas, a demo fee and daily slots. `db:purge:demo` removes it. The seed refuses `NODE_ENV=production`. Demo images load only if `NEXT_PUBLIC_MEDIA_ORIGINS` includes `https://wellfoodonline.com`. Do not show demo data publicly (third-party photos and prices).

### 2.2 First Super Admin (any environment)

```bash
export DATABASE_URL=…                                         # target database
read -rs SUPER_ADMIN_PASSWORD; export SUPER_ADMIN_PASSWORD    # not echoed, not in shell history
pnpm --filter @dudhwala/api cli:create-super-admin:dev -- --email owner@example.com --name "Owner Name"
# in a container: node dist/cli/create-super-admin.js --email … --name …
unset SUPER_ADMIN_PASSWORD
```

The command seeds system roles/permissions and audits the creation. The admin must enrol an authenticator at first login. Create **two** Super Admins (owner + one deputy) so one lost phone never stops the business.

Break-glass (a staff member — including a Super Admin — lost both the authenticator and the recovery codes): someone with database credentials runs

```bash
DATABASE_URL=… pnpm --filter @dudhwala/api cli:reset-mfa:dev -- --email person@example.com   # container: node dist/cli/reset-mfa.js --email …
```

It clears two-factor, ends all sessions and writes an audit entry. Outlet staff and managers are normally reset from the admin (**২-ধাপ রিসেট**).

## 3. Environment variables

All names, meanings and safe defaults are in `.env.example`. The API validates them at start-up (`apps/api/src/config/env.ts`) and refuses to start when, outside development:

- `API_PUBLIC_URL` is not https;
- the payment simulator is used in production (or on staging without `ALLOW_PAYMENT_SIMULATOR=true`);
- `SSLCOMMERZ_LIVE=true` outside production, or the sandbox in production;
- media storage is local disk (must be `s3`) or S3 settings are incomplete;
- the SMS provider is `log`, or the HTTP SMS URL is missing/not https;
- the dev SMS outbox is enabled.

Storefront/admin build arguments (`NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_MEDIA_ORIGINS`) are compiled into the browser bundle: build separate images for staging and production. Set `NEXT_PUBLIC_ALLOW_INDEXING=true` only for the public production storefront.

Secrets live only in the hosting platform's secret store, one set per environment. Rotation: `SESSION_SECRET`/`OTP_HMAC_KEY` rotation logs everyone out and invalidates pending OTPs (do it at a quiet hour); `DATA_ENCRYPTION_KEY` rotation needs a re-encryption script (not yet written — see Known limitations) because TOTP secrets are encrypted with it.

## 4. CI/CD pipeline (GitHub Actions)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to `main`, pull requests | install → codegen → lint → typecheck → Prisma validate → `prisma migrate deploy` on a fresh PostgreSQL 16 → migrations-vs-schema drift check → dev-DDL drift check → unit + integration tests (with the real migrations; test DB runs `TimeZone=Asia/Dhaka`) → production builds |
| `e2e.yml` | push to `main`, pull requests, manual | builds the full stack on PostgreSQL with the demo seed and simulator, runs 21 Playwright scenarios (mobile + desktop storefront, admin, rider, accessibility); uploads report and traces |
| `images.yml` | push to `main` (build only); manual with `staging`/`production` | builds `api`, `api-migrate`, `web`, `admin` images; on manual run pushes `ghcr.io/<owner>/dudhwala-<image>:<env>-<sha>` using that GitHub Environment's variables |
| `generate-migration.yml` | manual | regenerates a migration with Prisma's native engine on a review branch (used once for `0001_init`) |

Release flow **[needs account]**:

1. Merge to `main` → CI and E2E green.
2. Run **Images** for `staging` → deploy those tags on staging (release step runs `api-migrate` first).
3. Run the smoke test (§9) and a manual walk-through on staging.
4. Approve production: run **Images** for `production` with the same commit → take a manual DB snapshot → deploy (migrate first) → smoke test → watch errors and orders for 30 minutes.

Protect `main` (required checks: CI, E2E) and require reviewers on the `production` GitHub Environment. No deploy runs from a developer machine.

## 5. Domain and DNS **[needs account]**

1. The business owns the domain in its own registrar account with 2FA (H4).
2. Records: apex + `www` → storefront service; `admin` → admin service; `api` → API service; `media` → CDN/bucket; staging equivalents under `staging.`.
3. CAA record allowing only the platform's certificate authority.
4. SPF/DKIM/DMARC only if transactional email is added later.
5. TTL 300 s during launch week, then 3600 s.

## 6. HTTPS/TLS

- Certificates issued and renewed by the platform (ACME). Alert 14 days before expiry.
- HTTP → HTTPS redirect at the edge (301).
- The API sends HSTS (`max-age=31536000; includeSubDomains`) in production; Next.js apps send CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Cookies are `HttpOnly`, `Secure` (outside development), `SameSite=Lax` (customer) / `Strict` (staff).
- The API trusts one proxy hop (`X-Forwarded-For`) for client IPs used by rate limits. If the platform puts more than one proxy in front, adjust `trust proxy` in `apps/api/src/bootstrap.ts`.
- TLS 1.2+ only (platform setting).

## 7. Database migrations

- Migrations live in `apps/api/prisma/migrations` (`0001_init` … `0004_privacy_requests`). CI fails if migrations and `schema.prisma` disagree.
- New change: edit `schema.prisma` → `pnpm --filter @dudhwala/api exec prisma migrate dev --name <change>` → review the SQL (add CHECKs/partial indexes by hand when needed and mirror them in `prisma/sql/constraints.sql`) → commit.
- Release: the `dudhwala-api-migrate` image runs `prisma migrate deploy` once, before new API instances start.
- Expand/contract: add new columns first, deploy code that uses both, backfill, remove old columns in a later release, so the previous API version always runs on the new schema (rollback safety).
- Destructive migrations: take a snapshot in the same window and write a rollback note in the PR.

## 8. Backups and restore **[needs account]**

- Managed daily backups ≥ 14 days, PITR ≥ 7 days.
- Nightly logical dump to a different provider/account: `pg_dump -Fc "$DATABASE_URL" | age -r <public key> > dudhwala-$(date +%F).dump.age` uploaded with lifecycle 30 days. Keep the private key offline with the owner.
- Bucket versioning on; deleted versions kept 30 days.
- **Restore test before launch and quarterly**:
  1. Restore the latest backup (or a PITR point) to a new scratch database.
  2. `psql "$RESTORED_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/ops/verify-restore.sql` — checks latest migration, row counts, newest order/payment time, order and line totals, stock and ledger consistency, slot capacity, verified payments and append-only triggers. Every integrity query must return 0.
  3. Record date, backup time, result and who did it in the log below. Delete the scratch database.
- **Incident restore**: switch on maintenance mode (**সেটিংস → storefront.maintenance**) → restore to a new instance at the chosen point → run `verify-restore.sql` → point `DATABASE_URL` to it → redeploy → smoke test → switch maintenance off → reconcile payments for the gap window with the gateway report (PAYMENT_GATEWAY_GUIDE §3).

## 9. Smoke tests (after every deploy)

```bash
infra/ops/smoke.sh https://api.<domain> https://<domain> https://admin.<domain>
```

Read-only checks: API ready, catalogue answers, admin API refuses anonymous calls, `no-store` on private data, HSTS, Bangla storefront, CSP and frame protection on both apps, admin login page, HTTP→HTTPS redirect, dev SMS outbox and payment simulator not exposed. Exit code 0 = pass.

Staging additionally: one COD order end-to-end (place → confirm → dispatch → rider delivers → cash handover) and one sandbox online payment, as in OPERATIONS_GUIDE.

## 10. Monitoring and alerting **[needs account]**

- Uptime checks every minute: storefront `/`, admin `/login`, API `/v1/health/ready`.
- Platform alerts: 5xx rate > 2 % for 5 min, p95 latency > 2 s, instance restarts, DB CPU/storage > 80 %, certificate expiry, backup failure.
- Application signals to review daily (admin **ড্যাশবোর্ড**, **পেমেন্ট ও রিফান্ড**): reconciliation exceptions, payments pending > 30 min, COD discrepancies, failed SMS (daily cap reached), late orders.
- Logs: the API writes Nest log lines to stdout (every response carries an `x-request-id`, also logged with unexpected errors); payment mismatches, invalid IPN signatures, high-risk transactions and SMS failures are logged at warn/error. Retain ≥ 30 days.
- Error tracking (e.g. Sentry) is not wired yet (Known limitations); add with the chosen provider (H5).

## 11. Rollback

- App: redeploy the previous image tags (keep ≥ 10). Migrations are backward compatible within one release, so the previous API runs on the new schema.
- Bad migration: follow the PR's rollback note; worst case restore the pre-deploy snapshot (§8) with maintenance mode on.
- Payment trouble: **payments.online.enabled = false** (instant; COD continues where eligible).
- Anything customer-facing and urgent: **storefront.maintenance = true** (browsing stays up; ordering and paying pause).

## 12. Payment gateway and SMS set-up **[needs account]**

- Payments: PAYMENT_GATEWAY_GUIDE.md (SSLCOMMERZ sandbox → merchant approval → live test → daily reconciliation).
- SMS: choose a Bangladeshi bulk-SMS provider with an approved sender id (masking/non-masking). Map its HTTP API to `SMS_HTTP_*` (URL, method, fixed parameters such as `api_key` and `senderid`, recipient and message parameter names, phone format, success pattern). Test: request an OTP on staging with a real phone; check Bangla renders. Set `SMS_DAILY_CAP` and the order events in **সেটিংস → sms.events**.

## 13. Launch checklist

The full checklist is in IMPLEMENTATION_PLAN §6.

## Log

| Date | Event | Result |
|---|---|---|
| 2026-10-19 | Runbook drafted | No environments provisioned |
| 2026-10-21 | Images, release workflow, smoke test, restore check added | `infra/ops/verify-restore.sql` run against the local E2E database: all integrity checks 0. API image contents (pnpm deploy output) started and passed `/health/ready` locally; Next.js standalone storefront served `lang="bn"` and static assets. Docker images built in GitHub Actions (Images workflow). No hosting environment provisioned yet. |
