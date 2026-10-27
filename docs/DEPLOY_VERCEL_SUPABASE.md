# Deploying with Vercel, Supabase PostgreSQL and a separate NestJS API

Status: **written and checked against the code and a local PostgreSQL 16; never executed on Vercel or Supabase.** No deployment, Vercel project, Supabase project, CDN, payment gateway or SMS provider was touched. Labels used below:

- **verified locally**: exercised by a test or command in the development sandbox (test names are given);
- **unverified**: depends on live Vercel/Supabase/provider behaviour and must be confirmed on staging with real credentials.

It complements [DEPLOYMENT_RUNBOOK](DEPLOYMENT_RUNBOOK.md) (monitoring, backups, rollback) and [STAGING_CHECKLIST](STAGING_CHECKLIST.md) (the step-by-step list).

## 1. Topology

| Component | Host | Notes |
|---|---|---|
| Storefront `apps/web` | Vercel project 1 | `shop.example.com` (or apex) |
| Admin + rider `apps/admin` | Vercel project 2 | `admin.example.com` |
| API `apps/api` | Container host (Render, Railway, Fly.io, DigitalOcean, AWS…) running `infra/docker/api.Dockerfile` | `api.example.com`. Vercel cannot host this app: it is a long-running NestJS server with background jobs. |
| Database | Supabase PostgreSQL (16+) | used only as a database |
| Product/banner images | S3-compatible bucket + public CDN URL | Supabase Storage (S3 API) or Cloudflare R2, S3, Spaces |

**Custom domain on one registrable domain is required.** What the code does (verified locally by `apps/api/test/staging-cookies.test.ts`, which boots the API with staging-shaped settings):

| Item | Behaviour |
|---|---|
| Cookies | `dw_sid` (customer): HttpOnly, Secure, `SameSite=Lax`. `dw_admin_sid` (staff and riders): HttpOnly, Secure, `SameSite=Strict`. `dw_csrf`: Secure, `SameSite=Strict`, readable by script on purpose. **No `Domain` attribute on any of them**: they are host-only cookies of the API host (`api.example.com`). `Secure` is set when `NODE_ENV` is `staging` or `production`. |
| Why one domain | The browser calls the API directly with `credentials: 'include'`. `shop.`, `admin.` and `api.` under the same registrable domain are *same-site*, so Strict and Lax cookies are sent. `*.vercel.app` and most container-host domains are public suffixes: a storefront on `x.vercel.app` calling `y.onrender.com` is cross-site and logins, carts and CSRF cookies break. |
| CORS | Exactly two allowed origins, `WEB_ORIGIN` and `ADMIN_ORIGIN`, with credentials. Comparison is exact: no trailing slash, scheme and host must match, and `www.` vs apex are different origins (pick one, redirect the other at the edge). Vercel preview URLs are not allowed. Methods GET/POST/PUT/PATCH/DELETE; headers `content-type`, `x-csrf-token`, `idempotency-key`, `x-request-id`, `x-dw-audience`. |
| CSRF | State-changing requests need an `Origin` equal to `WEB_ORIGIN`/`ADMIN_ORIGIN` **and** the double-submit token: the `dw_csrf` cookie and the `x-csrf-token` header must be identical and carry a valid HMAC (`SESSION_SECRET`). Webhook and payment-simulator routes are exempt (verified server-to-server). |
| HTTPS | TLS is terminated by the host's proxy. `trust proxy` is `1`: exactly one proxy hop may sit in front of the API, or client IPs for rate limits are wrong. API `NODE_ENV=staging` and `production` require `API_PUBLIC_URL` to start with `https://`. **HSTS is sent only when `NODE_ENV=production`**, not on staging. Next.js apps send their own CSP, `X-Frame-Options: DENY`, `nosniff`. HTTP→HTTPS redirects are the platform's job (Vercel does it for the Next apps; enable it on the API host). |
| API responses | `Cache-Control: no-store` by default; the public catalogue endpoints opt in to shared caching. The storefront caches public API fetches for 30 s (`serverGet`); private data is only fetched from the browser. |

The same applies to staging: use `staging.example.com`, `admin.staging.example.com`, `api.staging.example.com`.

## 2. Supabase PostgreSQL

1. Create a **separate Supabase project per environment** (staging, production). Region near Bangladesh (Singapore). Never share a database between environments.
2. Connection strings (Project → Connect):
   - **Direct or session-mode connection (port 5432)** for `prisma migrate deploy` and for the API. The direct host is IPv6-only unless the IPv4 add-on is enabled; if the API host has no IPv6, use the **session pooler** string instead.
   - Avoid the **transaction pooler (port 6543)** **(unverified)**: the API uses interactive transactions and sends a startup parameter (`options=-c TimeZone=UTC`, `apps/api/src/prisma/prisma.service.ts`) that a transaction pooler may drop; with a non-UTC session timezone app-written timestamps shift (QA_TEST_PLAN §9).
   - The repository uses **one** variable, `DATABASE_URL`, for both Prisma (`apps/api/prisma.config.ts`) and the API (`@prisma/adapter-pg`). There is no separate direct/pooled pair: set the variable per process (release job vs API service).
   - **TLS (verified locally, important):** with the installed `pg` 8.23.1 / `pg-connection-string` 2.14.1, `?sslmode=require` is treated as `verify-full`, so the server certificate is verified against Node's trust store. Supabase database certificates chain to a Supabase CA that is normally not in that store, so the API may fail with a certificate error **(unverified against Supabase)**. Preferred fix: download Supabase's CA certificate from the dashboard (Database → SSL) and start the API with `NODE_EXTRA_CA_CERTS=/path/to/supabase-ca.crt`. `sslmode=no-verify` disables verification and is not recommended outside a throwaway test. `prisma migrate deploy` uses Prisma's own schema engine, whose TLS handling is **unverified**; test it first on the staging database and see STAGING_CHECKLIST for fallbacks.
3. Extensions: migration `0001_init` runs `CREATE EXTENSION IF NOT EXISTS citext` and `pg_trgm`. Both exist on Supabase **(unverified that the migration role may create them in `public`)**; confirm after the first migration.
4. **Data API exposure and least privilege.**

   What the schema contains (checked in `apps/api/prisma/migrations`): 54 tables and one trigger function (`forbid_mutation`, used by three append-only triggers) in schema `public`; extensions `citext` and `pg_trgm`; **no** grants, roles, row-level security, views, sequences (all keys are UUIDs) or `LISTEN/NOTIFY`. The API needs only `SELECT, INSERT, UPDATE, DELETE`; it never runs DDL.

   Supabase exposes every table in `public` to its `anon`/`authenticated` roles through the Data API (PostgREST) and grants them privileges on new tables by default. Dudhwala does not use that API. Apply **both** controls:

   1. Dashboard: Project Settings → Data API → turn it off (or remove `public` from exposed schemas). **(unverified: dashboard setting, cannot be tested from here).**
   2. Database: run `infra/ops/least-privilege.sql` as the migration owner (`postgres` on Supabase) after the first migration:
      ```bash
      psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 \
           -v app_role=dw_app -v app_password='<generated, never committed>' \
           -f infra/ops/least-privilege.sql
      ```
      It creates a login role `dw_app` (no superuser/createdb/createrole/bypassrls), grants it `SELECT, INSERT, UPDATE, DELETE` on all `public` tables (not on `_prisma_migrations`), sets default privileges so tables created by later migrations get the same grants, and revokes everything from `anon`, `authenticated` and `service_role` when those roles exist. It is idempotent.

   Run the **API** as `dw_app`; run **migrations** (`prisma migrate deploy`) as the owner. Verified locally on PostgreSQL 16 with simulated Supabase roles and default privileges:
   - `anon` and `authenticated` lose `SELECT` on every table; `dw_app` can read and write, cannot `CREATE`/`DROP` (permission denied) and cannot read `_prisma_migrations`;
   - a table created later by the owner is automatically writable by `dw_app` and not by `anon`;
   - the **complete E2E suite (25/25) and demo seed pass with the API connected as `dw_app`**, with no "permission denied" in the API log;
   - **do not enable row-level security** in this model: with no policies, RLS also denies `dw_app` (verified: "new row violates row-level security policy"). If you prefer RLS, connect the API as the table owner instead (owners bypass RLS unless `FORCE` is set) and keep the Data API off; that is simpler but gives the API DDL rights.
   - `USAGE` on schema `public` remains granted to `PUBLIC` by PostgreSQL's default, so `anon` keeps schema usage (and `EXECUTE` on extension functions) but sees no tables. This is why switching the Data API off is the primary control.

   **Unverified on Supabase:** that the `postgres` role may run the script as written; the exact pooler username format for a non-`postgres` role (Supavisor expects `<role>.<project-ref>`); and whether Supabase's dashboard features still work with these revocations. Never put the Supabase `anon` or `service_role` keys in any Vercel or API variable; they are not used.
5. Backups: enable the plan's daily backups/PITR and keep the nightly off-site `pg_dump` from the runbook. Test a restore with `infra/ops/verify-restore.sql` (verified locally: all checks return 0 on a fresh migrated database).

## 3. Image storage and persistence

How the code behaves (verified in code and tests):

- `MEDIA_STORAGE=local` writes files to `MEDIA_DIR` (default `./var/media`) on the API's own disk and serves them from `/v1/media/...`. **This survives a process restart on the same disk (verified locally: files uploaded before an API restart were still served), but is lost on every redeploy/replacement container and is not shared between API instances.** The API therefore **refuses to start** with `NODE_ENV=production` or `staging` unless `MEDIA_STORAGE=s3` (verified by loading the env schema).
- `MEDIA_STORAGE=s3` uploads WebP files (re-encoded, metadata stripped, random keys) with `Cache-Control: public, max-age=31536000, immutable` and stores only the key in PostgreSQL (`product_image.storage_key`). Images then survive restarts, redeploys and scale-out, as long as the bucket is kept.
- Uploaded files are not deleted from the bucket when an admin removes a photo in the UI (only the database row is removed). Enable bucket versioning and a lifecycle rule; do not rely on the bucket being empty.

How the adapter talks to storage (`apps/api/src/media/media.ts`, `S3MediaStorage`): AWS SDK v3 `S3Client` with the configured `endpoint`, **path-style addressing** whenever an endpoint is set (`forcePathStyle`), static credentials, and `PutObject` with `Bucket`, `Key`, `Body`, `ContentType: image/webp` and `CacheControl: public, max-age=31536000, immutable`. The public URL is simply `MEDIA_PUBLIC_URL` + `/` + key (keys look like `products/<uuid>.webp`). The adapter never reads, lists or deletes objects.

Verified locally by `apps/api/test/s3-media.test.ts` against a stand-in HTTP server: the request is `PUT <endpoint>/<bucket>/<key>` (path-style), SigV4-signed with the configured region, with the content-type and cache-control headers, and URL composition tolerates a trailing slash. Review finding fixed in this branch: SDK ≥ 3.729 attaches CRC32 checksum headers (`x-amz-checksum-crc32`, `x-amz-sdk-checksum-algorithm`) by default, which several S3-compatible providers reject; the client is now created with `requestChecksumCalculation: 'WHEN_REQUIRED'` and a test asserts no checksum or `aws-chunked` headers are sent.

Required configuration for **Supabase Storage** (API, staging and production). Values come from Supabase's documentation and could not be verified without a live project:

| Variable | Value | Status |
|---|---|---|
| `MEDIA_STORAGE` | `s3` | verified (API refuses `local` outside development) |
| `STORAGE_ENDPOINT` | `https://<project-ref>.storage.supabase.co/storage/v1/s3` (the `https://<project-ref>.supabase.co/storage/v1/s3` form is documented as equivalent) | unverified |
| `STORAGE_REGION` | the project's region code, e.g. `ap-southeast-1`; it must match what Supabase shows under Storage → S3 Connection, because SigV4 signs it | unverified |
| `STORAGE_BUCKET` | a bucket created in the dashboard and marked **Public** (so images can be read without signing) | unverified |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | an S3 access key pair created under Storage → S3 Connection (distinct from the project's API keys) | unverified |
| `MEDIA_PUBLIC_URL` | `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>` (no trailing slash needed) | unverified |
| `NEXT_PUBLIC_MEDIA_ORIGINS` (both Vercel projects) | `https://<project-ref>.supabase.co` | CSP behaviour verified; value unverified |

Security note: Supabase documents S3 access keys as having access to **all buckets in the project and bypassing storage policies**. Treat them as a high-value secret, use a dedicated Supabase project for media if the same project also holds other data, and keep them only in the API's secret store. A custom CDN domain in front of a bucket (set `MEDIA_PUBLIC_URL` and `NEXT_PUBLIC_MEDIA_ORIGINS` to it) is equally supported by the code. Cloudflare R2 or any other S3-compatible store works with the same variables (`STORAGE_REGION=auto` for R2).

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
   - `DATABASE_URL` (section 2): connect as the least-privilege `dw_app` role, not the owner; `NODE_EXTRA_CA_CERTS` pointing at Supabase's CA file if TLS verification fails (section 2)
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
| `NEXT_PUBLIC_SITE_URL` | optional: only passed as a Docker build argument by the image workflow; **no application code reads it today** | not used |
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
