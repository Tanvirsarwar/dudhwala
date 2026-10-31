# Vercel API spike (`apps/api` as a Vercel project)

**Goal:** prove the existing NestJS API runs as one Vercel function in front of Supabase, with no other host. Frontends are untouched.
**Status:** built and tested locally; **not deployed**. Nothing below has run on Vercel or against Supabase yet.

## What was added
| File | Purpose |
|---|---|
| `apps/api/src/serverless.ts` | Creates the Nest app once per warm instance (`createApp` + `init()`, no `listen()`), reuses it, returns a JSON 503 on a bad start and retries on the next request |
| `apps/api/api/index.js` | The Vercel function: re-exports the compiled `dist/serverless.js` |
| `apps/api/vercel.json` | Install/build from the monorepo root, include `dist/**`, 30 s max, rewrite `/v1/*` to `/api` |
| `apps/api/public/index.txt` | Placeholder static output directory |
| env `DATABASE_POOL_MAX` | pg pool size (default 10 locally, **1** on Vercel) |
| env `HEALTH_DIAG_TOKEN` + `GET /v1/health/runtime` | Off (404) unless the token is set. With `Authorization: Bearer <token>` returns pass/fail for Argon2, Sharp and a row-locking transaction on one connection. No secrets, no data. |
| `apps/api/package.json` `engines.node = 22.x` | Pins the Vercel runtime |

Nothing else changed: schema, migrations, business code and existing tests are as before.

## Verified locally
- `tsc` and eslint clean. API tests **157/157** (152 existing + 1 pool-size + 4 serverless tests), and **157/157 again with the pool forced to one connection** (`TEST_POOL_MAX=1`), which shows no code path needs a second connection while a transaction is open.
- `vercel build` (Vercel CLI 65.9, run locally against `apps/api`) succeeded. The function bundle is 53 MB (limit 250 MB) and contains `argon2/prebuilds/linux-x64/argon2.glibc.node`, `@img/sharp-linux-x64` (and musl), the generated Prisma client (pure JS driver adapter, no engine binary) and `@dudhwala/shared`.
- That bundle, started on its own with `NODE_ENV=production` against a local PostgreSQL 16 (migrations through 0006): `/v1/health/live`, `/v1/health/ready`, `/v1/catalog/categories` OK; `/v1/health/runtime` reports Argon2 ok, Sharp ok, a `FOR UPDATE` transaction ok, session time zone UTC.

## Not verified (needs Vercel and Supabase)
Real Vercel runtime; Supabase transaction pooler (port 6543) behaviour with the `pg` adapter; TLS to Supabase with the CA; cold-start time; **POST bodies through Vercel's request helpers** (check in step 8); cookies through a rewrite; `/v1/health/ready` against Supabase.

## Create the Vercel project (dashboard)
1. Vercel → *Add New → Project* → import the GitHub repo `Tanvirsarwar/dudhwala`, branch `spike/vercel-api` (not `main`).
2. **Root Directory:** `apps/api`. Turn on **Include source files outside of the Root Directory in the Build Step** (the build uses `packages/shared` and the root lockfile).
3. **Framework Preset:** Other. Leave Install/Build/Output at their defaults, because `vercel.json` sets them. **Node.js Version:** 22.x.
4. **Environment Variables** (Production and Preview; mark all as Sensitive; never `NEXT_PUBLIC_*`):
   - `NODE_ENV=production`
   - `DATABASE_URL` = Supabase *Connect → Transaction pooler* URI (port **6543**), password filled in
   - `DATABASE_CA_CERT` = Supabase CA certificate text (Project Settings → Database → SSL)
   - `DATABASE_POOL_MAX=1`
   - `SESSION_SECRET`, `OTP_HMAC_KEY`, `DATA_ENCRYPTION_KEY`: each `openssl rand -base64 32` (the last must decode to exactly 32 bytes, which this produces)
   - `API_PUBLIC_URL=https://<this project's .vercel.app URL>`; `WEB_ORIGIN` and `ADMIN_ORIGIN` = the two existing frontend URLs
   - `MEDIA_STORAGE=s3`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_URL` (Supabase Storage S3). The API refuses to start in production with local media.
   - `SMS_PROVIDER=http` and `SMS_HTTP_URL` (an https URL; the API refuses to start otherwise). For the spike use `https://sms-disabled.invalid/send`; customer login codes then cannot be sent.
   - `HEALTH_DIAG_TOKEN` = random string of at least 24 characters (spike only)
5. **Database:** use a new or empty Supabase database, or one you have backed up. Do **not** run `prisma migrate deploy` against a database with data you care about: migration `0005` drops all tables. For an empty database run from your machine with the *direct* connection string (not the pooler): `DATABASE_URL=<direct uri> pnpm --filter @dudhwala/api exec prisma migrate deploy`. The Vercel build never runs migrations.
6. Deploy.
7. Check, replacing `<api>`:
   - `curl https://<api>/v1/health/live` → `{"status":"ok"}`
   - `curl https://<api>/v1/health/ready` → `{"status":"ok"}` (this is the Supabase connection test)
   - `curl -H "Authorization: Bearer <HEALTH_DIAG_TOKEN>" https://<api>/v1/health/runtime` → `argon2.ok`, `sharp.ok`, `database.ok` all `true`, `poolMax: 1`
8. POST through Vercel's request handling:
   - `curl -si -c jar https://<api>/v1/auth/csrf` and note `csrfToken`
   - `curl -si -b jar -X POST https://<api>/v1/auth/staff/login -H 'content-type: application/json' -H "x-csrf-token: <token>" -H "origin: <WEB_ORIGIN>" -d '{"login":"nobody@example.com","password":"x"}'`
   - Expect **401** `UNAUTHENTICATED` JSON. A hang, a 500 or an empty-body 400 means Vercel's body handling conflicts with Express.
9. Time the first request after about 10 minutes idle (cold start) and note it.
10. When finished: delete `HEALTH_DIAG_TOKEN` (the diagnostics route then answers 404).

If step 7 or 8 fails, send the response body and the function log (Vercel → Logs). Likely fixes: the pooler URL or CA, or the request-body handling.
