# Deploying the Phase 2 backend

**Nothing has been deployed by this work.** This is the procedure; the commands below were exercised locally only (migrations via `psql`, backup/restore round trip, CLIs, health). Do not run anything against a real database without the checks in section 3.

## 1. Moving parts
API container (Node 22) · PostgreSQL 16 · S3-compatible bucket for product photos · storefront + admin (Next.js) · SMS HTTP provider (OTP) · payment provider (later). Dockerfiles: `infra/docker/api.Dockerfile` (targets `migrate` and `runtime`), `next.Dockerfile`; free-tier staging: `infra/docker/api.staging.Dockerfile` + `render.yaml`.

## 2. Environment (names only; values live in the host's secret store — never in Git, chat or `NEXT_PUBLIC_*`)
See `.env.example`. Required in production: `NODE_ENV=production`, `API_PUBLIC_URL` (https), `WEB_ORIGIN`, `ADMIN_ORIGIN` (exact origins, no trailing slash), `DATABASE_URL` (+ `DATABASE_CA_CERT` for verified TLS), `SESSION_SECRET`, `OTP_HMAC_KEY`, `DATA_ENCRYPTION_KEY` (32 bytes base64), `MEDIA_STORAGE=s3` + `STORAGE_*` + `MEDIA_PUBLIC_URL`, `SMS_PROVIDER=http` + `SMS_HTTP_*`. There are no payment variables (cash on delivery only). Supabase specifics: [SUPABASE_VERCEL](SUPABASE_VERCEL.md). The API refuses to start when: the API URL is not https, media is local disk, SMS is the console logger, or the dev SMS outbox is on. Error messages name variables, never values. Generate every secret separately per environment (`openssl rand -base64 32`).

## 3. Migrations — read before running
`apps/api/prisma/migrations/0005_v2_domain` **drops every table and enum in the `public` schema** (except `_prisma_migrations`) and creates the new schema. That is correct for an empty database or the throw-away staging/demo data of the old design, and wrong for anything holding data you want.
1. Take a backup first (section 5). 2. Confirm with `\dt` / row counts what is in the target. 3. Only then `cd apps/api && DATABASE_URL=… pnpm exec prisma migrate deploy`. 0006 (COD only + RLS) converts existing data in place; after that, migrations are normal additive ones; never edit an applied migration.
`prisma migrate deploy` never resets anything by itself. Do **not** use `migrate dev` or `migrate reset` against a shared or real database.
CI (`.github/workflows/ci.yml`) applies the migrations to an empty database and fails on drift against `schema.prisma`. If it reports drift for 0005 (the SQL was generated from the schema without Prisma's native engine), use the `generate-migration` workflow and commit its output as the next migration.

## 4. Release steps
1. Build images; run the `migrate` target as the release step (`prisma migrate deploy`) before new API containers get traffic.
2. First release only: `create-staff --role admin`, `setup --file owner-setup.json`, `import-catalogue` (see SETUP_OWNER_DATA). These CLIs run from the same image: `node dist/cli/<name>.js` (the catalogue file is at `../../demo/mock-api/catalogue.json` in the build image; pass `--file` otherwise).
3. Start the API; check `GET /v1/health/ready` → `{"status":"ok"}` (`/health/live` is for the container health check).
4. Run `infra/ops/smoke.sh <api> <web> <admin>` (read-only; places no orders).
5. Admin: log in, enrol 2FA, store recovery codes, create the manager account.
6. Least privilege (recommended): run `infra/ops/least-privilege.sql` as the owner role and give the API the DML-only role; use the owner role only for migrations.

## 5. Backup and restore
- **Backup:** managed-database daily snapshots with point-in-time recovery if offered, plus a logical dump before every migration: `pg_dump -Fc "$DATABASE_URL" -f dudhwala-$(date +%F).dump`. Store copies off the database host, encrypted; the dump contains customer phone numbers and addresses.
- **Restore test (do it before launch and quarterly):** `createdb restore_check && pg_restore -d restore_check --no-owner dudhwala.dump && psql restore_check -v ON_ERROR_STOP=1 -f infra/ops/verify-restore.sql`. Every integrity query must return 0 and the append-only trigger count must be 4. (A dump/restore round trip of a database holding test orders passed locally on 2026-10-28.)
- **Restore for real:** stop the API, restore into a new database, run `verify-restore.sql`, point `DATABASE_URL` to it, start the API. Product photos live in the bucket and are not in the dump — enable bucket versioning/replication.
- Secrets are not in the database. Losing `DATA_ENCRYPTION_KEY` makes admins' stored TOTP secrets unreadable (fix: `reset-mfa` + re-enrol); keep it in two places.

## 6. Rollback
- **Code:** redeploy the previous image. Migrations are forward-only; a release that added a migration must be backward compatible with the previous image (add columns nullable/defaulted first, remove them a release later).
- **Bad migration:** restore the pre-migration dump (section 5) — there is no automatic down-migration.
- **Wrong catalogue data:** edits are audited (`/admin/audit`); products can be hidden at once (`active=false`) without deleting.
- **Stuck stock:** staff can cancel any live order (releases its reservation).

## 7. Browser ↔ API: cookies, CORS, HTTPS
Session cookies are `HttpOnly`, `Secure` (staging/production), host-only; staff `SameSite=Strict`, customer `SameSite=Lax`. They are first-party only when the storefront, admin and API share one registrable domain (`shop.example.com`, `admin.example.com`, `api.example.com`) **or** the apps proxy `/v1` to the API (set `NEXT_PUBLIC_API_URL=/v1` and `API_PROXY_TARGET`; see FREE_STAGING). Browsers block third-party cookies on unrelated domains (e.g. `*.vercel.app` + `*.onrender.com`), so use the proxy or a shared domain. CORS allows exactly `WEB_ORIGIN` and `ADMIN_ORIGIN` with credentials; every write also needs the CSRF header. HSTS is sent in production; terminate TLS at the platform and keep `trust proxy` (one hop) so client IPs for rate limits are correct. Set `NEXT_PUBLIC_MEDIA_ORIGINS` to the bucket/CDN origin so the CSP allows product photos.

## 8. Logging and monitoring
Request id on every response (`x-request-id`) and in every error body. Logs contain: method/route errors with stack for 5xx, masked phone numbers, no passwords, OTP codes (except the development console SMS), session tokens, payment secrets or request bodies. The audit log (`/admin/audit`) is the business trail (who changed what, before/after; failed logins; rejected webhooks). Alert on: `/health/ready` failing, 5xx rate, repeated `auth.staff_login_failed`.
