> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Staging release checklist

For the first staging deployment on Vercel (storefront and admin), Supabase PostgreSQL and a separately hosted NestJS API. Background and the reasons behind each item are in [DEPLOY_VERCEL_SUPABASE](DEPLOY_VERCEL_SUPABASE.md). Nothing here has been executed against Vercel, Supabase, a CDN, SSLCOMMERZ or an SMS provider.

Rules for the whole checklist: no secret is ever written into the repository, a pull request or a chat; staging has its own database, bucket, secrets and domain; no production credential is used; none of the commands below drop, reset or truncate anything.

## 0. Before you start

- [ ] PR #1 reviewed and merged **by you** (this checklist does not merge anything).
- [ ] A domain you control with three names under one registrable domain: `staging.example.com` (storefront), `admin.staging.example.com`, `api.staging.example.com` (replace `example.com`).
- [ ] New, empty Supabase project for staging (not the production project).
- [ ] A container host account for the API (the repository builds `infra/docker/api.Dockerfile`).
- [ ] An S3-compatible bucket (Supabase Storage bucket marked Public, or R2/S3 + CDN).

## 1. Generate secrets (locally, store only in the platform secret stores)

```bash
openssl rand -base64 32   # run once for each of: SESSION_SECRET, OTP_HMAC_KEY, DATA_ENCRYPTION_KEY, PAYMENTS_WEBHOOK_SECRET, and the dw_app database password
```

`SESSION_SECRET` and `OTP_HMAC_KEY` need ≥ 32 characters; `DATA_ENCRYPTION_KEY` must decode to exactly 32 bytes (the command above produces that). Never reuse a value from another environment.

## 2. Database (Supabase staging)

Use the **direct or session-pooler** connection string with the **owner** (`postgres`) role for steps 2.2–2.4 only. Print only the host to confirm the target: `echo "$DATABASE_URL" | sed 's#.*@##; s#[/?].*##'`.

- [ ] 2.1 Check connectivity and TLS: `psql "$OWNER_DATABASE_URL" -c 'select 1'`. If the API later reports a certificate error, supply Supabase's CA (see DEPLOY_VERCEL_SUPABASE §2); if Prisma reports one, resolve it before continuing and do not fall back to unverified TLS for production.
- [ ] 2.2 Apply the committed migrations only:
  ```bash
  corepack enable && pnpm install --frozen-lockfile
  pnpm --filter @dudhwala/shared build
  export DATABASE_URL='<owner connection string>'   # shell only, never committed
  pnpm --filter @dudhwala/api prisma:generate
  pnpm --filter @dudhwala/api prisma:validate
  pnpm --filter @dudhwala/api exec prisma migrate status          # fresh database: 4 migrations pending
  pnpm --filter @dudhwala/api db:migrate:deploy                   # = prisma migrate deploy
  pnpm --filter @dudhwala/api exec prisma migrate status          # expect "Database schema is up to date!"
  pnpm --filter @dudhwala/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # expect exit code 0
  ```
  (these exact commands were run locally against a fresh PostgreSQL 16 database: all four migrations applied, status up to date, drift diff exit 0).
- [ ] 2.3 Restrict database access (least privilege):
  ```bash
  psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_role=dw_app -v app_password='<generated>' -f infra/ops/least-privilege.sql
  ```
  and switch the Supabase **Data API off** in the dashboard.
- [ ] 2.4 Integrity check: `psql "$OWNER_DATABASE_URL" -f infra/ops/verify-restore.sql` (all counts 0).
- [ ] 2.5 Confirm `dw_app` cannot change the schema: `psql "$APP_DATABASE_URL" -c 'create table zz_probe(x int)'` must fail with "permission denied".
- [ ] 2.6 Enable the plan's automatic backups.

Not for staging, not for production: `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, `e2e/stack.sh --fresh-db` (drops the database), `DROP`/`TRUNCATE` statements. The demo seed (`db:seed:demo`) loads third-party names, prices and hot-linked photos and runs on a `staging` database; use it only if you explicitly want a private demo, and run `db:purge:demo` before real data entry. Never run it against production.

## 3. API service (container host)

Set these in the host's secret store (names exactly as in `.env.example`):

| Variable | Staging value |
|---|---|
| `NODE_ENV` | `staging` |
| `API_PORT` | the platform's port (default 4000) |
| `API_PUBLIC_URL` | `https://api.staging.example.com` (must be https) |
| `WEB_ORIGIN` | `https://staging.example.com` (exact, no trailing slash) |
| `ADMIN_ORIGIN` | `https://admin.staging.example.com` |
| `LOG_LEVEL` | `info` |
| `DATABASE_URL` | connection string for the **`dw_app`** role (session/direct, TLS) |
| `NODE_EXTRA_CA_CERTS` | path to Supabase's CA file, only if TLS verification needs it |
| `SESSION_SECRET`, `OTP_HMAC_KEY`, `DATA_ENCRYPTION_KEY` | generated in step 1 |
| `DATA_ENCRYPTION_KEY_ID` | `k1` |
| `MEDIA_STORAGE` | `s3` |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` | see DEPLOY_VERCEL_SUPABASE §3 |
| `MEDIA_PUBLIC_URL` | public base URL of the bucket or CDN |
| `PAYMENTS_PROVIDER` | `fake` (simulator) |
| `ALLOW_PAYMENT_SIMULATOR` | `true` (staging only; the API refuses the simulator in production) |
| `PAYMENTS_WEBHOOK_SECRET` | generated, ≥ 32 characters |
| `SMS_PROVIDER` | `http` plus `SMS_HTTP_URL` (https), `SMS_HTTP_METHOD`, `SMS_HTTP_STATIC_PARAMS`, `SMS_HTTP_TO_PARAM`, `SMS_HTTP_TEXT_PARAM`, `SMS_HTTP_PHONE_FORMAT`, `SMS_HTTP_SUCCESS_PATTERN`, `SMS_DAILY_CAP`; `log` is refused outside development. No real SMS provider has been tested. |
| `ENABLE_DEV_OUTBOX` | unset or `false` (refused when true) |

Do not set real SSLCOMMERZ credentials (`SSLCOMMERZ_*`) until approved.

- [ ] 3.1 Deploy the image built from `infra/docker/api.Dockerfile` (≥ 1 instance for staging; production needs ≥ 2). The API validates its environment at start and exits with a list of problems if anything is unsafe or missing.
- [ ] 3.2 Create the first Super Admin (also loads system roles; run once, from a machine with the **owner** or `dw_app` URL):
  ```bash
  pnpm --filter @dudhwala/api build
  SUPER_ADMIN_PASSWORD='<long unique password>' pnpm --filter @dudhwala/api cli:create-super-admin -- --email you@example.com --name "Your Name"
  ```
- [ ] 3.3 Health checks:
  ```bash
  curl -fsS https://api.staging.example.com/v1/health/live    # process is up
  curl -fsS https://api.staging.example.com/v1/health/ready   # database reachable; 4xx/5xx means not ready
  ```

## 4. Storefront and admin (Vercel)

For each project: Root Directory `apps/web` / `apps/admin`, "Include files outside Root Directory" on, Node 22, install `pnpm install --frozen-lockfile`, build `pnpm --filter @dudhwala/shared build && pnpm --filter @dudhwala/<web|admin> build`.

| Variable | Storefront | Admin |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.staging.example.com/v1` | same |
| `NEXT_PUBLIC_MEDIA_ORIGINS` | origin of `MEDIA_PUBLIC_URL` (bare https origin; the build fails on anything else) | same |
| `API_INTERNAL_URL` | optional private API URL | not used |
| `NEXT_PUBLIC_ALLOW_INDEXING` | leave unset (staging must not be indexed) | not used |

These are compiled in at build time: change, then redeploy. Add the domains to the projects and create the DNS records Vercel shows; point `api.staging.example.com` at the API host.

## 5. Verification after deploy

- [ ] 5.1 `bash infra/ops/smoke.sh https://api.staging.example.com https://staging.example.com https://admin.staging.example.com`. **Expected staging deviations:** "API HSTS header (production)" fails because HSTS is only sent when `NODE_ENV=production`; "Payment simulator not exposed" fails because staging deliberately enables the simulator. Every other check should pass. Investigate anything else.
- [ ] 5.2 Browser checks on `https://staging.example.com`: home loads in Bangla; DevTools console shows no CSP errors; choose an area; add to cart; log in with a real phone only if an SMS provider is configured, otherwise stop here.
- [ ] 5.3 Admin: sign in at `https://admin.staging.example.com`, enrol two-factor, create a category and product, upload a photo, publish. Open the product on the storefront, hard refresh, redeploy the API, reload: the photo must still load (this is the storage persistence check).
- [ ] 5.4 Cookie check in DevTools → Application → Cookies for `api.staging.example.com`: `dw_admin_sid` HttpOnly, Secure, SameSite Strict; `dw_sid` HttpOnly, Secure, Lax; no `Domain` attribute.
- [ ] 5.5 Run a simulated order end to end with the payment simulator (success and failure paths).
- [ ] 5.6 Record anything that differs from this guide in DEPLOY_VERCEL_SUPABASE (the "unverified" labels exist for that).

## 6. Rollback

| Situation | Action |
|---|---|
| Bad web/admin release | Vercel → Deployments → promote the previous deployment (instant, no data change). |
| Bad API release | Redeploy the previous image tag. Migrations follow expand/contract, so the previous API runs on the newer schema. |
| Bad migration | Do not run reverse SQL by hand. Restore from the Supabase backup/PITR taken before the release into a **new** project or branch, verify with `verify-restore.sql`, then repoint `DATABASE_URL`. Take a manual backup immediately before every migration that changes or drops data. |
| Wrong environment variable | Correct it in the platform and redeploy; for `NEXT_PUBLIC_*`, rebuild. |
| Leaked secret | Rotate it at once: `SESSION_SECRET`/`OTP_HMAC_KEY` (logs everyone out), storage keys, database password. `DATA_ENCRYPTION_KEY` has no rotation script yet (runbook known limitation). |

## 7. Not done and not verifiable without live accounts

Vercel build and domain setup; Supabase extensions, TLS chain, pooler behaviour, Data API switch, S3 endpoint, region and public URL; real image CDN; SSLCOMMERZ sandbox; real SMS delivery; GitHub Actions run on this branch; OWASP ZAP scan; manual ASVS review; TalkBack pass.
