# Supabase + Vercel setup (cash on delivery only)

**Status:** the database layer is verified on a local PostgreSQL 16 only. Nothing here has been run against a real Supabase project or Vercel account; each step below that needs one is marked **[you]**.

## Architecture (unchanged, no new paid service)
Browser → Vercel (storefront `apps/web`, admin `apps/admin`; `/v1/*` proxied to the API) → API (`apps/api`, NestJS, free Render web service per `render.yaml`, or any Node host) → **Supabase Postgres** (and Supabase Storage through its S3 API for photos).
The API is the only thing that talks to the database. The browser never receives a Supabase URL or key; the project uses **no** Supabase client library, no `NEXT_PUBLIC_SUPABASE_*` variable and no service-role key. Authentication is the API's own (customer phone code, staff password + 2FA).

## Row Level Security
Migration `0006_cod_only_rls` enables RLS on **every** table with **no policies** and revokes `anon`/`authenticated` privileges. Result: if someone turned on or used Supabase's Data API (PostgREST) with the public anon key, every table answers with zero rows and every write is refused. The API connects with the project's database owner (`postgres`) or a dedicated role, which is not subject to RLS unless you add `FORCE`; do not add FORCE.
Tested (`apps/api/test/cod.test.ts`): RLS on for all tables, no policies, and a non-owner role with SELECT granted reads 0 rows from `order`, `user`, `product`.
Public product browsing, customer orders and admin operations are authorised **in the API** (route rules, sessions, ownership checks), not by RLS policies, because the browser has no direct database path. Also switch the Data API off: Supabase → Project Settings → API → disable (belt and braces).
Any table added by a later migration must also `ENABLE ROW LEVEL SECURITY` (copy the loop in 0006).

## Steps
1. **[you]** Create a Supabase project (Free plan) in the nearest region. Save the database password in a password manager.
2. **[you]** Project Settings → Database → *Connection string* → pick the **Session pooler** (IPv4) URI. This is `DATABASE_URL`. Also download the CA certificate (SSL) and use its text as `DATABASE_CA_CERT`.
3. **[you]** Storage → create a bucket for product photos; enable the S3 connection (Settings → Storage) and note endpoint, region, access key id/secret; make the bucket public-read for objects only (no listing). Set `STORAGE_*`, `MEDIA_PUBLIC_URL`, `MEDIA_STORAGE=s3`.
4. Back up first if the database holds anything (`docs/DEPLOY_PHASE2.md` §3, §5). Migration `0005` **resets** the old schema; `0006` converts existing orders (`PENDING_PAYMENT`→cancelled, `PREPAID`→placed; paid orders keep PAID).
5. Apply migrations from your machine or the release step: `DATABASE_URL=<owner uri> pnpm --filter @dudhwala/api exec prisma migrate deploy`. Safe to repeat; it only applies what is missing.
6. Seed: `create-staff`, `setup`, `import-catalogue` (see `docs/SETUP_OWNER_DATA.md`).
7. API host **[you]**: set the variables from `.env.example` (secrets generated per environment: `SESSION_SECRET`, `OTP_HMAC_KEY`, `DATA_ENCRYPTION_KEY`; `WEB_ORIGIN`/`ADMIN_ORIGIN` = the Vercel URLs; `API_PUBLIC_URL` https). There are **no** payment variables any more.
8. Vercel **[you]** — two projects from this repo:
   - storefront: root `apps/web`; env `NEXT_PUBLIC_API_URL=/v1`, `API_PROXY_TARGET=https://<api host>`, `NEXT_PUBLIC_MEDIA_ORIGINS=<MEDIA_PUBLIC_URL origin>`; do **not** set `NEXT_PUBLIC_DEMO_BRANDING`.
   - admin: root `apps/admin`; same `NEXT_PUBLIC_API_URL=/v1` and `API_PROXY_TARGET`.
   Same-origin proxying keeps the session cookies first-party (see DEPLOY_PHASE2 §7).
9. Run `infra/ops/smoke.sh <api> <web> <admin>`, then place one real test order of each type and mark it paid in the admin.

## Removed, deliberately
`PAYMENTS_PROVIDER`, `PAYMENTS_WEBHOOK_SECRET`, `ALLOW_PAYMENT_SIMULATOR`, `SSLCOMMERZ_*`, the `payment` / `payment_event` tables, webhook and sandbox routes, payment-hold expiry job. Nothing else read them (checked by search and by the test suite).

## Not verified
Real Supabase connection, pooler behaviour with Prisma, Storage S3 upload, Vercel build with the proxy, and the free-tier cold start of the API host. Do these before telling anyone the site is live.
