> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# Free staging preview (Vercel + Render + Supabase, demo data only)

Goal: a public **demo** of the real Dudhwala storefront and admin on free tiers, with synthetic data, no custom domain, no real payments and no real SMS.

**Status of this guide: nothing described here has been deployed.** The development sandbox cannot reach Vercel, Supabase or Render (its network proxy refuses those hosts) and holds no accounts or tokens for them, so every dashboard step below must be done by you. What *was* verified, and where, is listed in section 6. Provider screens and free-tier limits change; check the provider's own page if a label differs.

## 1. Architecture and why

| Part | Host | Reason |
|---|---|---|
| Storefront `apps/web` | Vercel project 1 (Hobby, free) | Next.js, no changes needed |
| Admin `apps/admin` | Vercel project 2 | Same |
| API `apps/api` (NestJS) | Render free web service (Docker) | Vercel Functions are unsuitable: the API is a long-running server with a background job runner (notifications, slot generation, payment expiry) and native modules (`argon2`, `sharp`). A serverless function would stop the jobs. |
| PostgreSQL | Supabase Free | Managed Postgres 16 |
| Product images | Supabase Storage (S3-compatible API) | The API refuses local-disk media outside development |

### Cookies and domains: same-origin proxy (no custom domain needed)

The API's cookies are host-only and `SameSite=Strict/Lax`, so a browser on `x.vercel.app` talking to `y.onrender.com` would lose them (both are public suffixes). The fix needs no custom domain: each Vercel project **proxies `/v1/*` to the API** (`rewrites()` in `apps/web/next.config.ts` and `apps/admin/next.config.ts`). The browser only ever talks to its own Vercel host, so the cookies the API sets belong to that host.

- Build variable `NEXT_PUBLIC_API_URL=/v1` (a path) turns this mode on; `API_PROXY_TARGET=https://<your-api>.onrender.com` is the destination. If `NEXT_PUBLIC_API_URL` is an absolute URL, nothing is proxied (the old behaviour).
- The API still checks the `Origin` header and the CSRF double-submit token. Each site's own origin must therefore be in `WEB_ORIGIN` / `ADMIN_ORIGIN` on the API.
- The storefront and admin are two different hosts, so a staff session never reaches the storefront.
- Server-side page rendering calls the API directly through `API_INTERNAL_URL` (absolute).
- Side effect: the API sees all visitors as coming from Vercel's address (one trusted proxy hop), so per-IP rate limits (OTP, login) are shared by everyone. Acceptable for a demo, not for production.

## 2. Decisions that limit what the preview can show (read first)

1. **Customer login and checkout cannot work.** Customers sign in with an SMS one-time code, and staging refuses the console SMS provider and the dev outbox (both would expose codes). We keep `SMS_PROVIDER=http` pointed at the never-resolving host `sms-disabled.invalid`, so **no SMS is sent and customers cannot log in or place orders.** You can show: home, categories, search, product pages, cart, area selection, the admin (login with two-factor, catalogue, price CSV, settings). To demonstrate orders end to end you must decide on one of: a real SMS provider (costs money, sends real SMS), or a demo-only fixed code for one allow-listed phone number (needs a code change and your approval; not implemented).
2. **Payments:** `PAYMENTS_PROVIDER=fake` is required for the API to start without SSLCOMMERZ credentials, with `ALLOW_PAYMENT_SIMULATOR=true`. The simulator moves no money. Online payment is **hidden at checkout by default** (`payments.online.enabled` is false); leave it off. No `SSLCOMMERZ_*` variable is set.
3. **Database role:** the API connects as Supabase's `postgres` role for today's preview. `infra/ops/least-privilege.sql` was verified only on a local PostgreSQL 16, not on Supabase, and is **not** run here (see section 7).
4. **Images:** the demo catalogue's photos are hot-linked from a third-party bakery site (private-demo data, see `docs/OPEN_DECISIONS.md`). They show only if you list that host in `NEXT_PUBLIC_MEDIA_ORIGINS` below and the host allows hot-linking. Photos you upload in the admin go to Supabase Storage and always work.

## 3. Dashboard steps

### 3.1 Supabase (about 10 minutes)

**Security-sensitive steps, read before you start:**

- **Never paste a password, key or connection string into chat, a GitHub issue, a commit or a screenshot.** Paste them only into the Render/Vercel/Supabase dashboard fields.
- **The database password** is the master password of the `postgres` role. In this preview the API connects as `postgres` (Supabase's owner role), so a leak of `DATABASE_URL` exposes the whole staging database. That is acceptable only because the database holds synthetic demo data. Use a generated password, store it in a password manager, and reset it (Project Settings → Database → Reset database password) if it is ever exposed. The least-privilege role is deferred (section 7).
- **The S3 access keys** (step 4) grant read/write to every bucket in the project and bypass storage policies. Create them only in this dedicated staging project, copy the secret once into Render, and delete the key (Storage → S3 Connection) when the preview is retired or if it leaks.
- **The Data API** is on by default and exposes tables to anyone holding the project's public `anon` key (which is not secret). Turn it off (step 2) before loading data.
- Do **not** use the Supabase `anon` or `service_role` keys anywhere; this app never needs them.
- The CA certificate is public information, not a secret.

1. supabase.com → sign in with GitHub → **New project**. Organisation: your own. Name `dudhwala-staging`. **Database password: use "Generate a password", keep it in a password manager, never paste it into chat, a commit or an issue.** Region: Singapore (`ap-southeast-1`). Plan: Free. Create and wait until the project is "Healthy".
2. **Disable the Data API** (Project Settings → Data API, switch off or remove `public` from exposed schemas). The app does not use it.
3. **Storage:** Storage → New bucket → name `dudhwala-media`, **Public bucket: on**.
4. **S3 credentials:** Project Settings → Storage → S3 Connection. Write down the **endpoint** (`https://<project-ref>.storage.supabase.co/storage/v1/s3`) and **region**. Create a new access key; copy the key ID and secret now (the secret is shown once). These keys can reach every bucket in the project; use this dedicated staging project only.
5. **Database CA certificate:** Project Settings → Database → SSL Configuration → download the certificate. Open it in a text editor; you will paste the whole text (`-----BEGIN CERTIFICATE-----` … `-----END CERTIFICATE-----`) into Render.
6. **Connection string:** click **Connect** → **Session pooler** (IPv4; Render cannot reach the IPv6-only direct host) → copy the URI. It looks like `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`. Put your password in; URL-encode special characters; **do not add `sslmode`** (the API takes TLS settings from the CA certificate).
7. Note: project ref, region.

Values you now hold (never share them in chat): `DATABASE_URL`, the CA text, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET=dudhwala-media`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, and `MEDIA_PUBLIC_URL=https://<project-ref>.supabase.co/storage/v1/object/public/dudhwala-media`.

### 3.2 Decide the two Vercel project names first

The API must know the final site URLs. Use names such as `dudhwala-staging-web` and `dudhwala-staging-admin`, giving `https://dudhwala-staging-web.vercel.app` and `https://dudhwala-staging-admin.vercel.app` (if a name is taken Vercel adds a suffix; then use the URL Vercel shows you).

### 3.3 Render: the API

1. render.com → sign in with GitHub → grant access to `Tanvirsarwar/dudhwala`.
2. **New → Blueprint** → pick the repository (Render uses the repository's default branch, `claude/vibrant-brahmagupta-r00411`, which now contains everything) → Render reads `render.yaml` → it asks for the variables marked below. Whether a free web service needs a payment card is **unverified**; if Render asks for one and you do not want to give it, stop here and tell me, and we will pick another host.
3. Fill in:

| Variable | Value |
|---|---|
| `API_PUBLIC_URL` | `https://dudhwala-api-staging.onrender.com` (use the exact URL Render shows if the name differs; no trailing slash) |
| `WEB_ORIGIN` | the storefront URL from 3.2 |
| `ADMIN_ORIGIN` | the admin URL from 3.2 |
| `DATABASE_URL` | Supabase session pooler URI (3.1 step 6) |
| `DATABASE_CA_CERT` | the certificate text (3.1 step 5) |
| `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_URL` | from 3.1 |
| `STAGING_ADMIN_EMAIL` | your admin email (a real address you control) |
| `SUPER_ADMIN_PASSWORD` | a long unique password (only used on first boot) |

   Render generates `SESSION_SECRET`, `OTP_HMAC_KEY`, `DATA_ENCRYPTION_KEY` and `PAYMENTS_WEBHOOK_SECRET` itself. Everything else in `render.yaml` is fixed (`NODE_ENV=staging`, `MEDIA_STORAGE=s3`, simulator on, SMS disabled).
4. **Apply.** The first build takes several minutes. On start the image applies the committed migrations (`prisma migrate deploy`, additive and idempotent), loads the labelled demo catalogue, creates the Super Admin and starts the API.
5. Check: open `https://<api-host>/v1/health/ready` → `{"status":"ok"}`, and `https://<api-host>/v1/catalog/products` → demo products.
6. Then, in Render → Environment: **delete `SUPER_ADMIN_PASSWORD`**, set `STAGING_SEED_DEMO` to `false`, save (redeploys once).

### 3.4 Vercel: storefront and admin

Do this twice (storefront `apps/web`, admin `apps/admin`). vercel.com → sign in with GitHub → **Add New → Project** → import `Tanvirsarwar/dudhwala`.

| Setting | Value |
|---|---|
| Project name | from 3.2 |
| Framework preset | Next.js |
| Root Directory | `apps/web` (admin: `apps/admin`); keep "Include source files outside of the Root Directory" enabled |
| Install Command | leave default (Vercel detects the pnpm workspace) |
| Build Command | **leave default** (`pnpm run build`; since commit `02fbccf` the app's `build` script builds `@dudhwala/shared` first). If you ever override it with plain `next build`, the build fails with `Module not found: Can't resolve '@dudhwala/shared'` (reproduced) because the shared package is only usable after it is compiled. |
| Node.js version | 22.x |

Environment variables (all environments). Those marked build are compiled in: change then redeploy.

| Variable | Storefront | Admin | Kind |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `/v1` | `/v1` | build |
| `API_PROXY_TARGET` | `https://<api-host>` (no path, no slash; must be https) | same | build (rewrites) |
| `API_INTERNAL_URL` | `https://<api-host>/v1` | not used | runtime |
| `NEXT_PUBLIC_PREVIEW_LABEL` | e.g. `ডেমো প্রিভিউ — আসল পণ্য বা দাম নয়। এখানে কোনো টাকা নেওয়া হয় না।` | e.g. `স্টেজিং — ডেমো ডেটা` | build |
| `NEXT_PUBLIC_MEDIA_ORIGINS` | `https://<project-ref>.supabase.co https://wellfoodonline.com` (second entry only for the third-party demo photos) | same | build |
| `NEXT_PUBLIC_ALLOW_INDEXING` | leave unset | n/a | build |

**Branch:** the repository's default branch is `claude/vibrant-brahmagupta-r00411`. Pull request #1 (the premium UI, staging files and fixes) has been merged into it, so deploy from that branch: keep Vercel's proposed branch and leave Production Branch as the default. Create the API through the **Blueprint** (Docker, `render.yaml`), not as a plain Node web service with `pnpm run build`: a generic build never ran `prisma generate`, which caused `Cannot find module '../generated/prisma/client.js'` in `apps/api`.

### 3.5 Finish wiring

If a Vercel URL differs from what you typed into `WEB_ORIGIN` / `ADMIN_ORIGIN`, correct them in Render and redeploy the API (the `Origin` check will otherwise answer 403 to every write).

## 4. Checks to run on the live URLs (none of these have been run on live URLs)

```bash
API=https://<api-host>; WEB=https://<web-host>; ADMIN=https://<admin-host>
curl -fsS $API/v1/health/ready                 # {"status":"ok"} (the first call can take ~1 minute: free instances sleep)
curl -fsS $WEB/v1/health/ready                 # same answer through the storefront proxy
curl -fsS $ADMIN/v1/health/ready               # same through the admin proxy
curl -sI $WEB | grep -i -E "^HTTP|content-security-policy"
bash infra/ops/smoke.sh $API $WEB $ADMIN       # expected failures on staging: "HSTS (production)" and "Payment simulator not exposed"
```

In a real browser: storefront home shows the preview banner and products; search "Opera"; add to cart (header count changes); cart page lists it; checkout asks for a phone and shows an error when the code cannot be sent. Admin: sign in with the email and password from 3.3, scan the shown key into an authenticator app, finish enrolment, open "পণ্য ও দাম". DevTools → Application → Cookies on each host: `dw_admin_sid` (admin) HttpOnly+Secure+Strict, `dw_sid`/`dw_cart` (storefront) HttpOnly+Secure+Lax, no Domain.

## 5. Free-tier limits and risks

- **Cold starts:** a free Render instance sleeps after about 15 minutes idle and needs up to a minute to wake. Storefront pages are rendered on demand and call the API, so the first page after a sleep can be slow or fail (Vercel Hobby also limits function duration). Before a demo open `$API/v1/health/ready` and wait for `ok`; optionally add a free uptime monitor pinging `/v1/health/live` every 5 minutes (a continuously awake free instance uses roughly the whole monthly free-hours allowance; check Render's current limits).
- **Supabase Free** pauses projects after about a week without activity and has small database/storage quotas (check current limits).
- **Vercel Hobby** is for non-commercial use.
- **Shared rate limits** (section 1) and **no customer login** (section 2).
- Demo data is third-party (names, prices, photos); the preview banner says so. Do not present these as Dudhwala products.
- No custom domain, no HSTS on staging, no uptime guarantees, no backups beyond Supabase's free plan defaults.

## 6. What was verified, and where

Verified locally in the development sandbox (PostgreSQL 16 with TLS and a private CA standing in for Supabase; the three Next/Nest processes run in staging-shaped configuration):

- API starts with `NODE_ENV=staging` and exactly the variables in `render.yaml`; it refuses unsafe combinations.
- `infra/docker/staging-entrypoint.sh`: applies the four migrations over **verified TLS** (a wrong CA is refused; Prisma needs `sslmode=require&sslaccept=strict&sslcert=<CA file>`: with only `sslmode=require` Prisma encrypts but does not verify), loads the demo catalogue, creates the Super Admin, starts the API; a second run is a no-op (no pending migrations, admin exists).
- The API's own connection (`DATABASE_CA_CERT`) verifies the server certificate: correct CA connects with TLS on; wrong CA and "no CA" are refused (`apps/api/test/pool-config.test.ts` covers the configuration logic).
- Same-origin proxy mode in a real Chromium: storefront and admin served by `next start` with `NEXT_PUBLIC_API_URL=/v1`: home, banner, product list, search, quick add (write through the proxy), cart, checkout shows no online payment and a visible error when the SMS cannot be sent, admin login with two-factor enrolment, admin API 401 anonymously and 200 with the session, admin catalogue loads. Cookies are host-only on the storefront host.
- Lint, typecheck, API tests, E2E: see the pull request description.

**Not verified:** anything on the live URLs; Vercel builds and rewrites to an external host; Render's Docker build, free-tier behaviour and required account details; Supabase TLS chain, pooler login, Storage S3 endpoint/region/public URL, Data API switch; cookies on real `*.vercel.app` hosts (localhost shares cookies across ports, so the storefront/admin cookie separation was not testable locally); that Vercel forwards the `Origin` header on rewrites (expected, untested); Lighthouse on the deployed site.

## 7. After the preview works

1. Least-privilege database role: review `infra/ops/least-privilege.sql` against Supabase (pooler usernames for a non-`postgres` role are `<role>.<project-ref>`), run it in Supabase's SQL editor with a generated password, change `DATABASE_URL` to the new role, and confirm product reads/writes from the admin before relying on it.
2. A real SMS provider (or approved demo-only login) to enable customer checkout.
3. A custom domain, then the production guide in `docs/DEPLOY_VERCEL_SUPABASE.md`.
