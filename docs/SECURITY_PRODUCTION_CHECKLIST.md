# Security and production-readiness checklist (Phase 2)

Legend: **Done** = implemented and covered by an automated test; **Config** = done in code, must be set correctly in the environment; **Open** = not done / needs the owner or a third party. No external penetration test or ASVS review has been done.

## Authentication and sessions
| Control | Status |
|---|---|
| Passwords hashed with Argon2id (64 MiB, t=3); minimum 12 characters; timing equalised for unknown accounts | Done |
| Same generic message for wrong password, unknown user, wrong login page | Done |
| Lockout after 5 failures / 15 min; 30 logins/hour/IP | Done |
| Admin two-factor (TOTP, replay-protected, 10 one-time recovery codes, secret AES-256-GCM encrypted) | Done |
| Sessions: random 256-bit token, only its SHA-256 stored, HttpOnly, SameSite, Secure in staging/production, server-side revoke, idle + absolute expiry | Done (Secure: Config) |
| Customer OTP: HMAC-stored, 5-minute life, 5 attempts, per-phone and per-IP limits, no account enumeration | Done |
| SMS provider for real OTP delivery | **Open** (owner) |
| Staff accounts cannot be created through the web; only by CLI with a password from the environment | Done |

## Authorisation
| Control | Status |
|---|---|
| Every route declares an access rule; undeclared routes are denied (tested by scanning all controllers) | Done |
| ADMIN vs MANAGER (read-only, `READ_ONLY` on every write) vs CUSTOMER vs anonymous, tested per endpoint group | Done |
| Customers reach only their own orders/cart; foreign ids give the same 404 as unknown ids | Done |
| Staff cookie ignored on customer routes and vice-versa | Done |
## Request safety
| Control | Status |
|---|---|
| CSRF double-submit token + Origin allow-list on all writes; webhooks authenticated by signature | Done |
| CORS limited to the two configured origins | Done (set origins: Config) |
| Strict zod validation on every body (unknown fields rejected, e.g. client-sent prices); size limits (64 KB, 8 MB for photos) | Done |
| Helmet headers, CSP `default-src 'none'`, no-store, HSTS in production, request ids | Done |
| Rate limits (login, OTP, orders, payment start, webhook, cart) in PostgreSQL so all instances share them | Done |
| No raw SQL with user input (parameterised template queries only) | Done |
## Business-rule integrity (server side)
| Control | Status |
|---|---|
| Prices, totals, bulk class, zone eligibility, hours, pickup rules computed from the database; client values ignored | Done |
| Stock: guarded atomic updates, no overselling under parallel orders, append-only ledger, CHECK constraints | Done |
| Idempotent order creation (header key + request hash), parallel duplicates create one order | Done |
| Payment: signature first, event dedupe, amount/currency match, first verified success wins, bulk order cannot reach PREPAID otherwise (also a database CHECK) | Done |
| Order status machine (one forward step, locked when finished), row lock on change | Done |
| Audit log of admin writes, order events, failed logins, rejected webhooks; update/delete blocked by trigger | Done |
## Data and files
| Control | Status |
|---|---|
| Uploads decoded and re-encoded (sharp), JPEG/PNG/WebP only, SVG refused, EXIF stripped, 5 MB cap, random keys | Done |
| Production requires S3-compatible storage; bucket must not allow listing or writes from the public | Config / **Open** (bucket policy) |
| Secrets only in environment; startup refuses unsafe combinations; errors never print values | Done |
| Database least-privilege role (`infra/ops/least-privilege.sql`) | Config (not applied anywhere) |
| Backups, restore test (`verify-restore.sql`) | Procedure + local round trip done; **Open** on the real database |
| PII: phone numbers and addresses stored in orders; retention period and deletion process not decided | **Open** (owner/legal); account-deletion requests were removed from scope |
## Not yet done
Real payment adapter and its sandbox/live certification · SMS provider test with a real phone · external penetration test / ZAP scan · load test · monitoring and alerting wiring · dependency audit (`pnpm audit` not re-run in this phase; the earlier zod 3.x advisory stands) · rotation script for `DATA_ENCRYPTION_KEY` · production deployment itself.

## Go-live gate (all must be true)
1. Owner data in (SETUP_OWNER_DATA 1–10, 15–17). 2. Real SMS works end to end. 3. Payment provider decision made; until then bulk orders stay off. 4. Restore test passed on the real database. 5. Admin 2FA enrolled, recovery codes stored. 6. `smoke.sh` passes against production URLs. 7. Someone has placed and fulfilled a real test order of each type.
