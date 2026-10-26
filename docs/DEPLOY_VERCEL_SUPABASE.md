# Deploying with Vercel, Supabase PostgreSQL and a separate NestJS API

Status: **written, not executed.** No deployment, Vercel project, Supabase project or provider account was touched while writing this. Every step below is a recommendation to be verified on a staging environment first. Items marked **(unverified)** depend on third-party platform behaviour that could not be tested from the development sandbox. It complements [DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md), which stays the reference for monitoring, backups and rollback.

## 1. Topology

| Component | Host | Notes |
|---|---|---|
| Storefront `apps/web` | Vercel project 1 | `shop.example.com` (or apex) |
| Admin + rider `apps/admin` | Vercel project 2 | `admin.example.com` |
| API `apps/api` | Container host (Render, Railway, Fly.io, DigitalOcean, AWS…) running `infra/docker/api.Dockerfile` | `api.example.com`. Vercel cannot host this app: it is a long-running NestJS server with background jobs. |
| Database | Supabase PostgreSQL (16+) | used only as a database |
| Product/banner images | S3-compatible bucket + public CDN URL | Supabase Storage (S3 API) or Cloudflare R2, S3, Spaces |

**Custom domain on one registrable domain is required.** Staff cookies are `SameSite=Strict` and customer cookies `SameSite=Lax`. `*.vercel.app` and most container-host domains are public suffixes, so a storefront on `x.vercel.app` calling an API on `y.onrender.com` is cross-site and logins/carts will not work. Put all three apps under one domain you own (`example.com`, `admin.example.com`, `api.example.com`). The same applies to staging (`staging.example.com`, `admin.staging.example.com`, `api.staging.example.com`).

## 2. Supabase PostgreSQL

1. Create a **separate Supabase project per environment** (staging, production). Region near Bangladesh (Singapore). Never share a database between environments.
2. Connection strings (Project → Connect):
   - **Direct / session-mode connection (port 5432)**: use for `prisma migrate deploy` and for the API. The direct host is IPv6-only unless the IPv4 add-on is enabled; if your container host has no IPv6, use the **session pooler** string (port 5432 on the `pooler.supabase.com` host).
   - Avoid the **transaction pooler (port 6543)** for this API **(unverified)**: the API opens interactive transactions and sets a startup parameter (`options=-c TimeZone=UTC`, `apps/api/src/prisma/prisma.service.ts`) that a transaction pooler may not honour. If the session timezone is not UTC, app-written timestamps shift (see QA_TEST_PLAN §9).
   - Append `?sslmode=require`.
3. Extensions: migration `0001_init` runs `CREATE EXTENSION IF NOT EXISTS citext` and `pg_trgm`. Both are available on Supabase; confirm they exist after the first migration **(unverified)**.
4. **Lock down the Supabase Data API.** The tables live in `public`, which Supabase exposes through PostgREST to the `anon`/`authenticated` roles. This app does not use that API; it connects directly as the database owner. Before any real data: Project Settings → Data API → disable it, or at minimum run on staging, then production:
   ```sql
   -- recommendation: not run by this repository
   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
   ```
   Re-check after each migration. Do not put the Supabase `anon`/`service_role` keys in any Vercel or API variable; they are not needed.
5. Backups: enable the plan's daily backups/PITR, and keep the nightly off-site `pg_dump` from the runbook. Test a restore with `infra/ops/verify-restore.sql`.

## 3. Image storage and persistence

How the code behaves (verified in code and tests):

- `MEDIA_STORAGE=local` writes files to `MEDIA_DIR` (default `./var/media`) on the API's own disk and serves them from `/v1/media/...`. **This survives a process restart on the same disk (verified locally: files uploaded before an API restart were still served), but is lost on every redeploy/replacement container and is not shared between API instances.** The API therefore **refuses to start** with `NODE_ENV=production` or `staging` unless `MEDIA_STORAGE=s3` (verified by loading the env schema).
- `MEDIA_STORAGE=s3` uploads WebP files (re-encoded, metadata stripped, random keys) with `Cache-Control: public, max-age=31536000, immutable` and stores only the key in PostgreSQL (`product_image.storage_key`). Images then survive restarts, redeploys and scale-out, as long as the bucket is kept.
- Uploaded files are not deleted from the bucket when an admin removes a photo in the UI (only the database row is removed). Enable bucket versioning and a lifecycle rule; do not rely on the bucket being empty.

Required configuration (API, staging and production):

| Variable | Value |
|---|---|
| `MEDIA_STORAGE` | `s3` |
| `STORAGE_ENDPOINT` | S3-compatible endpoint (Supabase: `https://<project-ref>.storage.supabase.co/storage/v1/s3`; R2: `https://<account>.r2.cloudflarestorage.com`) |
| `STORAGE_REGION` | provider region (`auto` for R2; the project's region for Supabase) |
| `STORAGE_BUCKET` | bucket name (public-read for objects, write only through the keys below) |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | credentials with write access to that one bucket only |
| `MEDIA_PUBLIC_URL` | public base URL that, with `/<key>` appended, serves the file. Supabase public bucket: `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>`; or a CDN/custom domain such as `https://media.example.com` **(unverified for Supabase)** |

Required configuration (each Next.js project, **build-time**):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_MEDIA_ORIGINS` | the origin of `MEDIA_PUBLIC_URL`, e.g. `https://media.example.com` (space-separated for several). Bare https origins only: no path, trailing slash or wildcard. The build **fails** on anything else. |

Why it matters: the storefront CSP `img-src` is built from this variable at build time. If it is missing, every real photo is blocked by the browser and each card shows the placeholder (the cause of the original image bug). Demo photo hosts are **not** in the production CSP; they are allowed only when `NODE_ENV !== 'production'` (verified by an E2E check against the production build).

Smoke test after the first upload on staging: upload a photo in Admin → open the product on the storefront → hard refresh → redeploy the API → confirm the image still loads and the browser console shows no CSP errors.

## 4. API deployment (container host)

1. Build from the repository root: `docker build -f infra/docker/api.Dockerfile -t dudhwala-api .` (runtime image) and `--target migrate -t dudhwala-api-migrate .` (release step). The repository's GitHub workflow already builds these.
2. Environment variables (names and meanings in `.env.example`; set in the host's secret store, one set per environment):
   - `NODE_ENV` = `staging` or `production`
   - `API_PORT` (platform port), `API_PUBLIC_URL` (`https://api.example.com`), `WEB_ORIGIN` (`https://shop.example.com`), `ADMIN_ORIGIN` (`https://admin.example.com`)
   - `DATABASE_URL` (section 2)
   - `SESSION_SECRET`, `OTP_HMAC_KEY` (each ≥ 32 chars), `DATA_ENCRYPTION_KEY` (32 bytes, base64), `DATA_ENCRYPTION_KEY_ID`. Generate with `openssl rand -base64 32`; different values per environment; never reuse or commit.
   - Media variables from section 3
   - Payments: staging may use `PAYMENTS_PROVIDER=fake` only with `ALLOW_PAYMENT_SIMULATOR=true` and `PAYMENTS_WEBHOOK_SECRET` (≥ 32 chars). Production must use `sslcommerz` with live credentials. **Do not configure real payment credentials until approved.**
   - SMS: `SMS_PROVIDER=http` with the provider variables (production); `log` is refused outside development.
   - `ENABLE_DEV_OUTBOX` must be unset/false.
3. Health checks: liveness `GET /v1/health/live`, readiness `GET /v1/health/ready`. Run ≥ 2 instances in production. The API trusts exactly one proxy hop (`trust proxy 1`); adjust if the host adds more.
4. The API refuses to start with unsafe combinations (non-https `API_PUBLIC_URL`, simulator in production, local media outside development, `log` SMS in production, and so on).

## 5. Vercel projects (storefront and admin)

Create two projects from the same GitHub repository. For each:

| Setting | Storefront | Admin |
|---|---|---|
| Root Directory | `apps/web` | `apps/admin` |
| Include files outside Root Directory | enabled (needed for `packages/shared`) | enabled |
| Framework preset | Next.js | Next.js |
| Install command | `pnpm install --frozen-lockfile` | same |
| Build command | `pnpm --filter @dudhwala/shared build && pnpm --filter @dudhwala/web build` | `pnpm --filter @dudhwala/shared build && pnpm --filter @dudhwala/admin build` |
| Node.js version | 22.x | 22.x |

`packages/shared` must be built before the app (the build command above does that); `transpilePackages` handles the rest. Vercel builds are **(unverified)** here: the repository was only built with `next build` locally and in Docker CI.

Environment variables (Production and Preview scopes set separately; they are baked into the build, so changing one needs a redeploy):

| Variable | Storefront | Admin |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.example.com/v1` | same |
| `API_INTERNAL_URL` | optional private API URL for server-side fetches; defaults to `NEXT_PUBLIC_API_URL` | not used |
| `NEXT_PUBLIC_SITE_URL` | `https://shop.example.com` | not used |
| `NEXT_PUBLIC_MEDIA_ORIGINS` | media origin (section 3) | same |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `true` only on the public production site; otherwise unset | not used |

Never put secrets in `NEXT_PUBLIC_*` variables. Vercel Preview deployments get `NODE_ENV=production`, so they do not allow demo image hosts; point previews at the staging API and add a staging `WEB_ORIGIN`/`ADMIN_ORIGIN` entry only if you use a stable preview domain (the API allows exactly one origin each).

DNS: add the domains in each Vercel project and the DNS records Vercel asks for; `api.example.com` points at the container host. Add a CAA record for the chosen certificate authorities. Registrar account with 2FA owned by the business.

## 6. Safe migration steps for a fresh **staging** database

The repository has four committed migrations (`0001_init` … `0004_privacy_requests`) plus `prisma/sql/constraints.sql` (already inside the migrations). Only `migrate deploy` is used outside development.

1. Create a new, empty Supabase project for staging. Confirm you are pointing at it: print the host part of `DATABASE_URL` (never the password).
2. Use the **direct or session-pooler** connection with `sslmode=require`.
3. From a clean checkout of the branch you are deploying:
   ```bash
   corepack enable && pnpm install --frozen-lockfile
   pnpm --filter @dudhwala/shared build
   export DATABASE_URL='postgresql://…'          # staging only, never committed
   pnpm --filter @dudhwala/api prisma:generate
   pnpm --filter @dudhwala/api prisma:validate
   pnpm --filter @dudhwala/api exec prisma migrate status   # fresh DB: shows 4 pending
   pnpm --filter @dudhwala/api db:migrate:deploy            # applies committed migrations only
   pnpm --filter @dudhwala/api exec prisma migrate status   # expect: Database schema is up to date
   pnpm --filter @dudhwala/api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code   # expect exit 0 (no drift)
   ```
   Or run the `dudhwala-api-migrate` image as the host's release/pre-deploy command, which executes the same `prisma migrate deploy`.
4. Run the Supabase lockdown from section 2.
5. Create the first Super Admin (this also loads the system roles and permissions):
   ```bash
   pnpm --filter @dudhwala/api build
   SUPER_ADMIN_PASSWORD='<long unique password>' pnpm --filter @dudhwala/api cli:create-super-admin -- --email you@example.com --name "Your Name"
   ```
   (inside the container image the same CLI is `node dist/cli/create-super-admin.js`). Enrol two-factor on first login.
6. Start the API, check `/v1/health/ready`, then run `infra/ops/smoke.sh` against staging.

**Never** run these outside a disposable local database: `prisma migrate dev`, `prisma migrate reset`, `prisma db push`, `DROP DATABASE`, `e2e/stack.sh --fresh-db` (it drops and recreates the target database).

**Demo data:** `db:seed:demo` loads third-party bakery names, prices and hot-linked photos for private demos. It refuses `NODE_ENV=production`, but it will run against a `staging` database. Use it on staging only if you explicitly want a demo, never against production, and remove it with `db:purge:demo` before real data entry.

Rollback: the runbook's expand/contract rule applies; take a Supabase backup/snapshot before any migration that changes or drops data.

## 7. Go-live gaps (unchanged)

Real catalogue and photos from the business; SSLCOMMERZ sandbox/live verification and SMS provider test with a real phone; OWASP ZAP scan and manual ASVS review; TalkBack pass; restore test on the managed database; Lighthouse on the real CDN; GitHub Actions run of CI/E2E/Images on the branch.
