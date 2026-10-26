# Security Review

Status: Design-stage review v0.1 — 2026-10-19. Re-run at Milestone 7 against the implementation; results recorded in §9.

## 1. Assets and threats

| Asset | Threats |
|-------|---------|
| Customer PII (name, phone, address) | Enumeration, IDOR, over-exposure to riders/staff, log leakage, breach of backups |
| Payment integrity | Forged callbacks, amount tampering, replayed IPNs, success-URL spoofing, double capture |
| Inventory and slot integrity | Race conditions/overselling, cross-outlet tampering |
| Staff accounts | Credential stuffing, phishing, shared passwords, privilege escalation |
| OTP / SMS budget | SMS pumping fraud, brute force |
| Business data (sales, reports) | Unauthorised export, cross-outlet visibility |
| Secrets (gateway keys, DB, SMS) | Commit to repo, exposure in front-end bundles or logs |

## 2. Authentication

- **Customers**: phone OTP. 6-digit codes from CSPRNG, stored as HMAC-SHA256 with server key, 5-minute expiry, max 5 attempts per challenge, single use. Rate limits per phone and IP (API spec §7). Phone normalised to E.164 before limiting. Bangladesh-only number prefix check (`+8801[3-9]`) reduces SMS-pumping to foreign premium numbers. Daily SMS spend cap with alert.
- **Staff**: login + password (min 12 chars, checked against a breached-password list offline, no composition rules), argon2id (memory ≥ 64 MB, iterations 3). TOTP MFA required for SUPER_ADMIN and OUTLET_MANAGER; recovery codes (10, single-use, hashed). Account lock after repeated failures; unlock by SA; audited.
- **Sessions**: 256-bit random token, only SHA-256 stored. Customer: 30-day absolute, 7-day idle. Staff: 12-hour absolute, 30-min idle; rider: 12-hour absolute, 2-hour idle. Session rotated on login and privilege change; all sessions revoked on password reset, role change, suspension.
- **Cookies**: `HttpOnly; Secure; Path=/`; staff cookie `SameSite=Strict` on admin origin; customer `SameSite=Lax`; `__Host-` prefix where the cookie is origin-bound.
- **Password reset (staff)**: SA-initiated reset link, single-use, 30-minute expiry, emailed or shown once to SA; no self-service reset via SMS for managers in v1 (reduces SIM-swap risk).

## 3. Authorization

- Permission guard on every controller method (lint rule fails the build if a staff/customer route lacks a `@RequirePermission` or `@Public`/`@CustomerOnly` decorator).
- Outlet scope from session assignments; route `:outletId` must be in scope; repositories require `AccessContext`. Out-of-scope ⇒ 404.
- Object ownership checks for customers (`user_id`) and riders (`rider_user_id`).
- Rider data minimisation and time-boxed contact visibility (USER_ROLES §4).
- Mass-assignment prevented by explicit DTOs; `status`, `outletId`, prices and totals never accepted from clients where the server owns them.
- Integration test matrix enumerates every admin/rider endpoint × (other outlet id, other customer id, lower role) — see QA_TEST_PLAN §4.

## 4. Payment security

- Hosted checkout or provider-tokenised flow only; no card data touches our servers (keeps PCI scope to SAQ-A level). No PAN/CVV fields exist in any form or table.
- Merchant credentials only in API environment variables / secret manager; never in front-end env (`NEXT_PUBLIC_*` lint check forbids names matching `/SECRET|KEY|PASSWORD|TOKEN/`).
- Callback handling: store raw event → dedupe by provider event id → verify signature/hash if offered → **server-to-server verification query** → compare merchant_tran_id, amount, currency, status → transactional update. Success URLs carry no authority.
- Idempotent state transitions: payment update uses `WHERE status IN (allowed-from)`; zero rows ⇒ already processed ⇒ no-op.
- Amount locked at payment creation; order totals immutable after placement (changes only via refund).
- Duplicate capture detection and alert (DATABASE_SCHEMA §9).
- Refunds: SA only, reason required, Idempotency-Key, cannot exceed paid − refunded, audited.
- Reconciliation job + daily settlement report review (OPEN_DECISIONS E6).

## 5. Web application controls

| Control | Implementation |
|---------|----------------|
| TLS | HTTPS only; HSTS `max-age=31536000; includeSubDomains` after domain confirmed (preload later); HTTP→HTTPS redirect at edge. |
| Injection | Prisma parameterised queries; raw SQL only via tagged templates; no string-built SQL (lint rule). |
| XSS | React escaping; no `dangerouslySetInnerHTML` except sanitised admin rich text (DOMPurify server-side on save, allow-list tags). CSP: `default-src 'self'; img-src 'self' <cdn>; script-src 'self' 'nonce-…'; frame-ancestors 'none'; form-action 'self' <gateway>`. |
| CSRF | Double-submit token + SameSite cookies + Origin header check on mutating routes. |
| CORS | API allows only exact storefront and admin origins with credentials; no wildcard. |
| Clickjacking | `frame-ancestors 'none'`, `X-Frame-Options: DENY`. |
| Headers | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal (camera only on rider proof page if enabled). |
| File uploads | Size limits, magic-byte type check, re-encode with sharp (strips EXIF/GPS), random keys, served from storage domain with `Content-Disposition: inline` and correct type; no SVG uploads. |
| Enumeration | OTP request returns same response for any phone; order numbers non-sequential; 404 for foreign ids. |
| Rate limiting | See API spec §7; also global per-IP ceiling. |
| Dependency risk | Lockfile committed; `pnpm audit` + GitHub Dependabot/OSV scan in CI; fail on high/critical with no override note. |
| Secrets in repo | `.env*` git-ignored except `.env.example`; gitleaks pre-commit + CI scan. |
| Errors | Generic messages to clients; stack traces only in logs/Sentry; request id returned. |

## 6. Data protection

- Data minimisation: checkout collects name, phone, address, area, optional instructions only. Email optional.
- Logs: pino redaction paths for `phone`, `address`, `password`, `otp`, `authorization`, `cookie`, gateway payload secrets; phone masked as `+88017******67`.
- Encryption: TLS in transit; managed DB encryption at rest; TOTP secrets and notification recipients encrypted at application level (AES-256-GCM, key from secret manager, key id stored for rotation).
- Backups: provider-encrypted, access restricted to SA ops account with MFA; restore tested quarterly (DEPLOYMENT_RUNBOOK §8).
- Retention & deletion: per OPEN_DECISIONS F6; deletion anonymises user and address data while keeping order financial records.
- Staging never contains production personal data.
- Bangladesh's personal-data protection legislation status must be checked with counsel before launch (OPEN_DECISIONS F6).

## 7. Abuse prevention

- SMS pumping: per-phone/IP limits, BD-prefix check, daily spend cap, anomaly alert (> X OTPs/hour).
- Fake COD orders: configurable COD max value, optional COD block for phones with ≥ N failed deliveries (setting), first-order COD limits (E4).
- Coupon abuse: per-customer limits tied to verified phone; usage counted transactionally.
- Slot hoarding: unpaid online holds expire (E7); per-customer cap on simultaneous `PENDING_PAYMENT` orders (default 2).
- Bot traffic: rate limits first; CAPTCHA (e.g. Turnstile) only if abuse observed.

## 8. Security testing plan and status (2026-10-21)

| Activity | Status |
|---|---|
| Authorization tests: 98-case outlet matrix, outlet/rider isolation for orders, COD, slots, reports, stock counts, transfers, hours; customer-to-customer 404s; manipulated ids | ✅ automated (API suite, every push) |
| Payment security: forged/unsigned IPNs, replayed IPNs, amount and currency mismatch, success-URL-only, duplicate capture, paid-after-expiry, refund limits — simulator and SSLCOMMERZ adapter | ✅ automated |
| CSRF (signed double-submit + Origin), CORS allow-list, staff cookie ignored on storefront routes, session expiry/revocation, TOTP replay across instances, lockout | ✅ automated |
| Rate limits: OTP request/verify, staff login (per account + per IP), coupon attempts per IP, checkout per customer, payment actions per order — shared across instances | ✅ automated |
| Sensitive-data exposure: no password/token/TOTP fields in responses, CSV formula-injection safe, gateway payload redaction, masked phones in logs | ✅ automated (selected endpoints) |
| Upload validation: magic bytes, size, SVG refused, re-encoded (metadata stripped) | ✅ automated |
| Static: TypeScript strict, ESLint (incl. ban on `$queryRawUnsafe`/`$executeRawUnsafe` outside tests) | ✅ every push |
| Dependency scan: `pnpm audit` | ✅ 2026-10-21: no known vulnerabilities. Add Dependabot/OSV scheduling in the repository settings. |
| Secret scan | ⚠️ manual grep only (no gitleaks in CI yet) |
| Dynamic scan (OWASP ZAP baseline) | ❌ not run — needs a staging URL |
| Manual ASVS L2 review and an external penetration test | ❌ before launch (recommended) |

## 9. Findings log

| Date | Finding | Severity | Status |
|------|---------|----------|--------|
| 2026-10-19 | Design review only; no implementation yet. | — | — |
| 2026-10-19 | TOTP replay guard (last accepted step per user) is held in API memory. With ≥ 2 API instances (DEPLOYMENT_RUNBOOK §1.1) a code could be replayed once against another instance within its 30–90 s window. Fix: persist `mfa_last_step` on `user` with a conditional update. | Low | **Fixed** (migration 0002): `user.mfa_last_step` claimed with a conditional update; cross-instance replay test passes |
| 2026-10-19 | Staff login has per-account lockout (5 / 15 min) but no per-IP limit yet (API_SPECIFICATION §7: 30/hour/IP). | Medium | **Fixed** (migration 0002): PostgreSQL fixed-window counters (`rate_limit_bucket`) for staff login and OTP verify per IP, shared across instances; tests pass |
| 2026-10-19 | Fail-closed routing: AccessGuard denies any route without an explicit access decorator; matrix tests cover all outlet-scoped routes so far. | — | Implemented |
| 2026-10-21 | Database session time zone: the Prisma pg adapter sends timestamps without a zone, so on a server whose default `TimeZone` is not UTC, app-written instants were stored shifted (6 h on Asia/Dhaka) while DB defaults were correct — wrong expiry/cut-off comparisons and audit times. | High | **Fixed**: sessions pinned to `TimeZone=UTC` in `PrismaService`; test database runs with server `TimeZone=Asia/Dhaka`; regression test. |
| 2026-10-21 | Double-submitted checkout could return HTTP 500 to one of the two requests (idempotency key claimed with a non-atomic upsert). No duplicate orders were created. | Medium | **Fixed**: atomic `INSERT … ON CONFLICT DO NOTHING` claim; loser always returns the winner's order. |
| 2026-10-21 | Coupon, checkout and payment endpoints had no rate limits (required by brief §13). | Medium | **Fixed**: per-IP coupon, per-customer checkout and per-order payment limits; tests. |
| 2026-10-21 | No way to reset a staff member's password or two-factor, or for staff to change their own password. | Medium | **Fixed**: self-service change (current password, other sessions end), manager/Super Admin reset with session revocation and audit, break-glass `reset-mfa` CLI. |
| 2026-10-21 | `storefront.maintenance` setting existed but did nothing. | Low | **Fixed**: pauses checkout and payment; storefront banner. |
| 2026-10-21 | SSLCOMMERZ return endpoint could have become an open redirect if it accepted a target URL. | — | Designed out: only an order id travels; the API rebuilds the storefront URL from configuration; test covers a hostile value. |
| 2026-10-21 | IPN `verify_sign` algorithm implemented from SSLCOMMERZ's PHP integration, not from an official specification. | Low | Open — confirm with SSLCOMMERZ. Safety does not depend on it (every IPN is followed by a server-side transaction query). |
| 2026-10-21 | Next.js storefront/admin CSP allows `'unsafe-inline'` scripts (nonces not wired). | Low | Open — no third-party scripts are loaded; wire nonces before adding any. |
| 2026-10-21 | `DATA_ENCRYPTION_KEY` rotation has no re-encryption script; OTP/session secrets rotation logs everyone out. | Low | Open — write the rotation script before the first planned rotation. |
| 2026-10-21 | No external error tracking or alerting wired (only platform logs). | Medium (operational) | Open — choose provider (OPEN_DECISIONS H5). |
