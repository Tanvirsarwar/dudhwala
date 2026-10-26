# API Specification

Status: v1.0 — 2026-10-21. This file describes conventions, contracts and error codes. **The authoritative list of implemented routes and their access rules is [API_ROUTES.md](API_ROUTES.md)**, generated from the controller sources (`apps/api/scripts/routes.mjs`). No OpenAPI/Swagger document is generated (decision: keep the surface small; the generated route table plus integration tests are the contract).

Added since v0.1 (see API_ROUTES.md): SSLCOMMERZ IPN `POST /v1/webhooks/payments/sslcommerz` and browser return `POST /v1/webhooks/payments/sslcommerz/return?order=&hint=` (redirect only, never sets status); outlet hours/closures `/v1/admin/outlets/:outletId/hours|closures`; stock counts `/v1/admin/outlets/:outletId/stock-counts`; transfers `/v1/admin/transfers` (setting-gated); privacy `/v1/me/privacy`, `/v1/me/privacy/export`, `/v1/me/privacy/delete-request`, `/v1/admin/privacy-requests`; staff `POST /v1/auth/staff/password`, `…/staff/:assignmentId/activate|reset-credentials`. New error code `SERVICE_UNAVAILABLE` (503) while maintenance mode is on. Rate limits added: coupon 10/10 min per IP, checkout 30/10 min per customer, payment actions 10/10 min per order (429 + `Retry-After`).

## 1. Conventions

- Base URL: `https://api.<domain>/v1`. JSON only, UTF-8.
- Auth: session cookie `dw_sid` (customer, set on `api.` with `Domain=<domain>` only if storefront and API share the registrable domain) or `dw_admin_sid` (staff, admin origin only). `HttpOnly; Secure; SameSite=Lax` (customer) / `SameSite=Strict` (admin).
- CSRF: double-submit token. `GET /v1/auth/csrf` sets `dw_csrf` (readable cookie); mutating requests send header `X-CSRF-Token` with the same value. Webhooks are exempt (verified differently).
- Idempotency: `Idempotency-Key` header (UUID) **required** on `POST /checkout/orders`, `POST /payments/*/initiate`, refunds, rider status updates. Same key + same body → stored response; same key + different body → `409 IDEMPOTENCY_CONFLICT`.
- Money: integers in poisha, field suffix `Poisha`; currency always `"BDT"`.
- Times: ISO 8601 UTC in responses; business dates as `YYYY-MM-DD` (Asia/Dhaka).
- Pagination: `?cursor=&limit=` (default 20, max 100) → `{ data: [...], nextCursor }`.
- Language: `Accept-Language: bn|en` for localised fields; responses include both `nameBn` and `nameEn` where relevant.
- Validation: zod schemas from `packages/shared`; unknown fields rejected.

### 1.1 Error format

```json
{
  "error": {
    "code": "OUT_OF_STOCK",
    "message": "একটি বা একাধিক পণ্য স্টকে নেই",
    "details": [{ "variantId": "…", "requested": 3, "available": 1 }],
    "requestId": "req_01J…"
  }
}
```

| HTTP | Codes |
|------|-------|
| 400 | `VALIDATION_FAILED` |
| 401 | `UNAUTHENTICATED`, `MFA_REQUIRED`, `OTP_INVALID`, `OTP_EXPIRED` |
| 403 | `FORBIDDEN` (permission missing — not used for out-of-scope ids) |
| 404 | `NOT_FOUND` (also returned for ids outside the caller's scope) |
| 409 | `OUT_OF_STOCK`, `SLOT_FULL`, `PRICE_CHANGED`, `NO_SINGLE_OUTLET`, `INVALID_TRANSITION`, `IDEMPOTENCY_CONFLICT`, `VERSION_CONFLICT`, `COUPON_INVALID` |
| 422 | `AREA_NOT_SERVICEABLE`, `MIN_ORDER_NOT_MET`, `COD_NOT_ELIGIBLE`, `CUTOFF_PASSED` |
| 429 | `RATE_LIMITED` (with `Retry-After`) |
| 502/503 | `PAYMENT_PROVIDER_UNAVAILABLE`, `SERVICE_UNAVAILABLE` |

## 2. Auth

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `GET /auth/csrf` | none | Issue CSRF cookie |
| `POST /auth/otp/request` | none | `{ phone, purpose }` → `{ challengeId, expiresInSec, resendAfterSec }`. Always returns 200 shape even for unknown numbers. Rate limits §7. |
| `POST /auth/otp/verify` | none | `{ challengeId, code }` → sets customer session; returns `{ user }` |
| `POST /auth/staff/login` | none | `{ login, password }` → `{ mfaRequired: true, mfaToken }` or session |
| `POST /auth/staff/mfa` | mfaToken | `{ mfaToken, totp }` → session |
| `POST /auth/staff/mfa/enroll` / `confirm` | staff | TOTP enrolment (QR otpauth URI returned once) |
| `POST /auth/logout` | any | Revoke current session |
| `POST /auth/logout-all` | any | Revoke all user sessions |
| `GET /me` | any | Current user; for staff also role, outlet, MFA state and effective permissions |

## 3. Public catalogue (no auth, cacheable)

| Endpoint | Notes |
|----------|-------|
| `GET /catalog/categories` | Tree |
| `GET /catalog/products?category=&q=&sort=price_asc|price_desc|newest|relevance&inStock=&areaId=&cursor=` | `availability` per variant is `AVAILABLE`, `UNAVAILABLE`, or `UNKNOWN` (no area) |
| `GET /catalog/products/:slug?areaId=` | Detail incl. optional content fields present only when set |
| `GET /catalog/collections/:slug` | Admin collections |
| `GET /content/home` | Banners, collections, FAQ (approved only) |
| `GET /content/pages/:slug` | About, policies |
| `GET /delivery/areas` | Served areas (active only) |
| `GET /delivery/check?areaId=` | `{ serviceable: boolean }` — no fee/outlet details exposed |

## 4. Cart and checkout (customer or anonymous cart token)

Anonymous carts use cookie `dw_cart` (random 32-byte token, HttpOnly). On login, carts merge (quantities summed, capped by availability).

| Endpoint | Body / result |
|----------|---------------|
| `GET /cart` | Re-priced cart: lines with current unit price, line totals, availability, `subtotalPoisha`, warnings |
| `PUT /cart/items/:variantId` | `{ quantity }` (0 removes) |
| `PUT /cart/area` | `{ areaId }` |
| `PUT /cart/coupon` / `DELETE /cart/coupon` | `{ code }` → validity + reason |
| `POST /checkout/quote` | `{ addressId \| address{...}, areaId }` → `{ serviceable, blockingLines[], slots: [{ slotKey, startsAt, endsAt, remaining: "AVAILABLE"|"FEW"|"FULL" }], paymentMethods: ["ONLINE","COD"?] }` (exact capacity not exposed) |
| `POST /checkout/price` | `{ areaId, slotKey, couponCode? , paymentMethod }` → `{ subtotalPoisha, discountPoisha, deliveryFeePoisha, totalPoisha, codEligible, quoteHash, expiresAt }` |
| `POST /checkout/orders` | Headers: `Idempotency-Key`. Body: `{ address, areaId, slotKey, paymentMethod, couponCode?, quoteHash, acceptedPolicyVersion }` → `201 { orderId, orderNumber, status, paymentStatus, paymentId?, next: "REDIRECT"\|"CONFIRMATION" }`. Errors: 409/422 codes above. |

`quoteHash` = HMAC of (cart lines, prices, fee, discount, total, slotKey). Placement recomputes; mismatch → `PRICE_CHANGED` with new price block.

## 5. Payments

| Endpoint | Auth | Notes |
|----------|------|-------|
| `POST /payments/:paymentId/initiate` | owner | Creates gateway session from DB amount → `{ redirectUrl }`. Fails if order not `PENDING_PAYMENT` or hold expired. |
| `POST /payments/:orderId/retry` | owner | New payment row if previous `FAILED`/`CANCELLED` and hold valid |
| `POST /payments/:orderId/switch-to-cod` | owner | Only if COD eligible and no payment `PENDING` at gateway (verified first) |
| `GET /orders/:orderId/payment-status` | owner | `{ orderStatus, paymentStatus }` for return-page polling |
| `POST /webhooks/payments/:provider` | gateway | IPN/webhook. Body stored raw; signature checked; server-to-server verification performed; always `200` after durable storage (so gateway stops retrying) unless storage fails (`500` → gateway retries). |
| `GET /webhooks/payments/:provider/return` | none | Not used for status decisions; storefront owns return pages. |

Verification acceptance criteria (all must hold): provider status = success; `merchant_tran_id` matches a payment row; amount == `payment.amount_poisha`; currency == BDT; provider transaction id not already linked to another payment; signature/hash valid where the provider supports it; IP allow-list check where the provider publishes IPs.

## 6. Customer account

`GET/PATCH /me/profile` · `GET/POST /me/addresses` · `PATCH/DELETE /me/addresses/:id` · `GET /me/orders` · `GET /me/orders/:id` (includes status events, items snapshot, delivery slot, payment status) · `POST /me/orders/:id/cancel` · `POST /me/orders/:id/reschedule-request` · `POST /me/orders/:id/reorder` · `POST /me/privacy/export-request` · `POST /me/privacy/delete-request`.
All filtered by `user_id = session.userId`; foreign ids → 404.

## 7. Rate limits (defaults, configurable)

| Endpoint | Limit |
|----------|-------|
| `POST /auth/otp/request` | 1 per 60 s per phone; 5 per hour per phone; 20 per hour per IP |
| `POST /auth/otp/verify` | 5 attempts per challenge; 30 per hour per IP |
| `POST /auth/staff/login` | 5 per 15 min per account (then 15 min lock, audited); 30 per hour per IP |
| `PUT /cart/coupon` | 10 per 10 min per cart/IP |
| `POST /checkout/*` | 30 per 10 min per session |
| `POST /payments/*` | 10 per 10 min per order |
| Webhooks | Not rate-limited by IP (gateway retries) but body size ≤ 64 KB |

## 8. Admin API (`/admin/...`, staff session)

Every route lists its permission; outlet-owned routes are nested under `/admin/outlets/:outletId/...` **and** the guard checks `outletId ∈ session scope`; `SUPER_ADMIN` may also call consolidated routes without `:outletId`.

### Outlets & staff
- `GET/POST /admin/outlets` (`outlets.manage` for POST) · `GET/PATCH /admin/outlets/:outletId` · `PUT /admin/outlets/:outletId/hours` · `POST /admin/outlets/:outletId/closures`
- `GET/POST /admin/outlets/:outletId/staff` · `PATCH /admin/outlets/:outletId/staff/:assignmentId` · `POST /admin/outlets/:outletId/staff/:assignmentId/deactivate` (revokes sessions) · `POST /admin/users/:id/suspend` · `POST /admin/users/:id/reset-mfa` (SA)

### Settings
- `GET /admin/settings` · `PUT /admin/settings/:key` `{ value }` (`settings.global`) · `GET /admin/outlets/:outletId/settings` · `PUT /admin/outlets/:outletId/settings/:key` (`settings.outlet`, OUTLET-scoped keys only). Keys, types and safe defaults: `apps/api/src/settings/settings.registry.ts`.

### Catalogue (SA)
- Implemented (M3): `GET/POST /admin/categories`, `PATCH /admin/categories/:id`, `GET/POST /admin/products`, `GET/PATCH /admin/products/:id`, `POST /admin/products/:id/variants`, `PATCH /admin/variants/:id` (price changes also need `pricing.manage_global`; audited as `catalog.price_change`), `POST /admin/products/:id/publish` (`catalog.publish`; records approver; editing content later reverts to DRAFT), `POST /admin/products/:id/archive`.
- Planned: CRUD `/admin/categories`, `/admin/products`, `/admin/products/:id/variants`, `/admin/products/:id/images` (multipart, ≤ 5 MB, JPEG/PNG/WebP, re-encoded), `POST /admin/products/:id/publish`
- CRUD `/admin/collections`, `/admin/banners`, `/admin/pages`, `/admin/faq`

### Inventory
- `GET /admin/outlets/:outletId/inventory?lowStock=&q=`
- `POST /admin/outlets/:outletId/inventory/receive` `{ variantId, qty, note }`
- `POST /admin/outlets/:outletId/inventory/adjust` `{ variantId, deltaQty, reason, expectedVersion }`
- `POST /admin/outlets/:outletId/inventory/write-off`
- `PATCH /admin/outlets/:outletId/inventory/:variantId` `{ lowStockThreshold, isListed }`
- `GET /admin/outlets/:outletId/stock-movements?from=&to=&variantId=&type=`
- `POST /admin/outlets/:outletId/stock-counts` · `PUT .../stock-counts/:id/lines` · `POST .../stock-counts/:id/complete`
- `POST /admin/transfers` · `POST /admin/transfers/:id/approve|dispatch|receive|cancel`

### Orders
- `GET /admin/outlets/:outletId/orders?status=&from=&to=&q=&slotDate=`
- `GET /admin/outlets/:outletId/orders/:orderId`
- `POST /admin/outlets/:outletId/orders/:orderId/transition` `{ to, reason? }` — server validates transition table + permission per target state
- `POST .../orders/:orderId/reschedule` `{ slotId }`
- `GET /admin/outlets/:outletId/picklist?slotId=`
- `GET /admin/orders?outletId=&...` (SA consolidated)

### Delivery
- CRUD `/admin/areas`, `/admin/zones` (SA) · `PUT /admin/outlets/:outletId/zone-rules/:zoneId`
- CRUD `/admin/outlets/:outletId/slot-templates` · `GET /admin/outlets/:outletId/slots?date=` · `PATCH /admin/outlets/:outletId/slots/:slotId` `{ capacity, status }` (capacity cannot go below `booked_count`)
- `POST /admin/outlets/:outletId/deliveries/:deliveryId/assign` `{ riderUserId }` (rider must be assigned to the same outlet)
- `GET /admin/outlets/:outletId/cod?status=` · `POST .../cod/:id/confirm-handover` · `POST /admin/cod/:id/resolve` (SA)

### Payments (SA)
- `GET /admin/payments?status=&provider=&from=&to=` · `GET /admin/payments/:id` (incl. events)
- `POST /admin/payments/:id/verify` (manual re-verify) · `GET /admin/reconciliation/exceptions`
- `POST /admin/payments/:id/refunds` `{ amountPoisha, reason }` (Idempotency-Key)

### Coupons, reports, audit, settings
- CRUD `/admin/coupons` (SA)
- `GET /admin/reports/sales?outletId=&from=&to=&groupBy=day|outlet|category` · `/admin/reports/inventory` · `/admin/reports/delivery` · `/admin/reports/cod` · `?format=csv` with `*.export_csv` permission (audited)
- `GET /admin/audit?outletId=&actor=&action=&from=&to=`
- `GET/PUT /admin/settings` (SA) · `GET/PUT /admin/outlets/:outletId/settings`

## 9. Rider API (`/rider/...`, DELIVERY_STAFF)

- `GET /rider/deliveries?date=` — only `rider_user_id = me`, status not closed (+ grace window)
- `GET /rider/deliveries/:id`
- `POST /rider/deliveries/:id/status` `{ to: "PICKED_UP"|"ARRIVED", clientUpdateId }`
- `POST /rider/deliveries/:id/complete` `{ deliveryCode?, codCollectedPoisha?, clientUpdateId }`
- `POST /rider/deliveries/:id/fail` `{ reason, note, clientUpdateId }`
- `POST /rider/deliveries/:id/proof` (multipart, only if enabled)

## 10. Health

`GET /health/live` (process up) · `GET /health/ready` (DB reachable, migrations current) — no secrets or versions of dependencies exposed publicly.
