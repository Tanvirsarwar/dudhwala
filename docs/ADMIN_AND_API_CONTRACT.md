# API contract (Phase 2 backend v1.0)

Base path `/v1`. JSON. Money is integer poisha (`null` = price not set yet). Times are ISO-8601 UTC; the business clock is Asia/Dhaka (UTC+6, no DST). The local demo's mock API (`demo/mock-api`) follows the same shapes for catalogue, cart, config, admin products/categories; it differs only where marked **demo**.

## Conventions
- **Errors:** `{ "error": { "code", "message", "details?", "requestId" } }`. Codes: `VALIDATION_FAILED 400`, `UNAUTHENTICATED 401`, `MFA_REQUIRED 401`, `OTP_INVALID/OTP_EXPIRED 401`, `FORBIDDEN 403`, `READ_ONLY 403`, `NOT_FOUND 404`, `OUT_OF_STOCK/PRODUCT_UNAVAILABLE/INVALID_TRANSITION/CONFLICT/IDEMPOTENCY_CONFLICT 409`, `PRICE_NOT_SET/NOT_DELIVERABLE/ZONE_REQUIRED/ORDERING_CLOSED/PICKUP_INVALID/BULK_REQUIRED/NOT_BULK 422`, `ACCOUNT_LOCKED 423`, `RATE_LIMITED 429`, `BULK_NOT_CONFIGURED/SERVICE_UNAVAILABLE 503`. Oversized body → 413, malformed JSON → 400. Stack traces never reach clients.
- **Cookies:** customer `dw_sid` (HttpOnly, SameSite=Lax), staff `dw_admin_sid` (HttpOnly, SameSite=Strict), cart `dw_cart`; `Secure` in staging/production. Customer calls send `x-dw-audience: customer` so a staff cookie in the same browser is never used for shopping.
- **CSRF:** every non-GET needs `x-csrf-token` (from `GET /auth/csrf`, double-submit cookie `dw_csrf`) and an allowed `Origin`.
- **Idempotency:** `POST /orders` requires `Idempotency-Key` (8–64 of `A-Za-z0-9_-`).

## Roles
| Role | Login page | Can do |
|---|---|---|
| ADMIN | `/login` | everything below; **two-factor (TOTP) mandatory** |
| MANAGER | `/manager/login` | all `GET /admin/*`; every write → `403 READ_ONLY`. 2FA used if enrolled. |
| CUSTOMER | storefront, mobile OTP | own cart and own orders only |

`POST /auth/staff/login {login, password, as?: "manager"}` → `{role, mfaRequired, mfaEnrolled}`. Each role works only on its own page; any mismatch answers like a wrong password. 5 failures in 15 min lock the account (`423`); 30 attempts/hour/IP. Sessions: staff 12 h absolute / 30 min idle; customer 30 d / 7 d idle. Passwords: Argon2id.

## Auth
| Call | Access | Notes |
|---|---|---|
| `GET /auth/csrf` | public | `{csrfToken}` |
| `POST /auth/otp/request {phone}` | public | 1/min and 5/hour per phone, 20/hour per IP. Response never reveals whether the number is registered. |
| `POST /auth/otp/verify {challengeId, code}` | public | 5 attempts, 5-minute life; merges the anonymous cart |
| `POST /auth/staff/login`, `POST /auth/logout` | public | |
| `POST /auth/staff/mfa/enroll` → `{secret, otpauthUri}`; `/mfa/confirm {code}` → `{recoveryCodes[10]}` (shown once); `POST /auth/staff/mfa {code}` (TOTP or recovery code, 204) | staff (before MFA) | TOTP codes cannot be replayed |
| `POST /auth/staff/password {currentPassword,newPassword≥12}` | staff | ends other sessions |
| `GET /me` | any session | `{user, role, canEdit, mfaVerified}` |

## Public (storefront)
| Call | Purpose |
|---|---|
| `GET /catalog/categories` | active categories |
| `GET /catalog/products?category&q&sort=newest\|price_asc\|price_desc&inStock&page&limit≤48` | cards `{id,slug,nameBn,nameEn,categorySlug,image,outerCityStatus,fromPricePoisha,inStock,variants[{id,labelBn,pricePoisha,compareAtPoisha,availability}]}`; only `active` products in `active` categories; **stock counts are never exposed**, only `IN_STOCK`/`OUT_OF_STOCK` |
| `GET /catalog/products/:slug` | detail with `content`, `images`, `variants[].maxQty` |
| `GET /config` | `{hours:{openMinute,closeMinute}, bulk:{minTotalQuantity,minTotalPoisha,isPlaceholder}, deliveryFees:{IN_CITY,OUTER_CITY}, paymentMethods:["COD"]}` (fees in poisha; the UI labels the zones **In Sylhet** / **Outer Sylhet**) |
| `GET /outlets` | active outlets with weekly `hours` |
| `GET /content/home`, `GET /content/pages/:slug` | owner-written pages (empty until supplied) |
| `GET /cart`, `PUT /cart/items/:variantId {quantity 0..999}` | server cart, re-priced on every read; unpriced/hidden/out-of-stock refused |

## Orders (customer, signed in)
`POST /orders` body (strict; unknown fields such as prices are rejected — **prices always come from the database**):
```json
{ "method": "HOME_DELIVERY|EXPRESS_PICKUP|BULK_ORDER",
  "zone": "IN_CITY|OUTER_CITY",                          // home delivery
  "lines": [{ "variantId": "uuid", "quantity": 1 }],
  "address": { "name", "phone", "line1", "landmark?" },  // home delivery
  "contact": { "name", "phone" },                         // pickup, bulk
  "outletId": "uuid", "pickupAt": "ISO-8601" }            // pickup
```
Server rules, in order (first violated rule is returned): ordering open (hours from settings) → product active and priced → quantity ≤ per-order cap → bulk classification (quantity **or** amount; bulk cart must be `BULK_ORDER`, non-bulk cannot) → home delivery: zone chosen, address present, every product eligible for the zone (Outer Sylhet: bakery, or `outerCityStatus=approved`; `pending_*`/`disabled` never) → pickup: ≥ 60 min ahead, ≤ 7 days, outlet open that weekday/time (outlet with no hours entered falls back to ordering hours) → stock reserved atomically at the fulfilling outlet (home: dispatch outlet; pickup: chosen outlet; bulk: Modina Market Branch) → a showroom order additionally needs the collection outlet configured. One database transaction; any failure reserves nothing.

Result `201` (replay with the same key and body: `200`, `replayed:true`; same key with a different body: `409 IDEMPOTENCY_CONFLICT`). Initial status: `PLACED` / `PICKUP_REQUESTED` / `PLACED`.
`GET /orders`, `GET /orders/:id`, `GET /orders/:id/status` — **owner only**; another customer's id answers `404`, same as an unknown id.

Order view: `{id, orderNumber, createdAt, method, zone, status, paymentMethod, paymentStatus, paidAt, lines[{variantId,productSlug,nameBn,nameEn,labelBn,quantity,unitPricePoisha,linePoisha}], subtotalPoisha, deliveryFeePoisha(0), totalPoisha, address|null, contact|null, pickupAt, outlet, history[{status,at}]}`.

### Status flows (forward only, one step at a time; `CANCELLED` from any live status)
- Home: `PLACED → PREPARING → OUT_FOR_DELIVERY → DELIVERED`
- Pickup: `PICKUP_REQUESTED → PREPARING → READY_FOR_PICKUP → PICKED_UP` (the customer sees pickup as confirmed only at `READY_FOR_PICKUP`)
- Showroom order (`method=BULK_ORDER`, shown as **Order From Showroom**; cart reaches the quantity/amount threshold; collected at Modina Market Branch): `PLACED → PREPARING → READY_FOR_COLLECTION → COLLECTED`
Cancelling releases the stock reservation; finishing commits it. Finished and cancelled orders are locked. Defined in `packages/shared/src/ordering.ts` (`ORDER_FLOW`).

## Payment: cash on delivery only
Every order has `paymentMethod: "COD"` and `paymentStatus: "UNPAID" | "PAID"` (with `paidAt`), independent of the delivery status. Placing an order never marks it paid, and the client cannot send either field (strict schema). An **ADMIN** records the cash with `PATCH /admin/orders/:id/payment {paymentStatus}` (audited; not allowed on cancelled orders; managers get `READ_ONLY`). There is no online payment, gateway, webhook or payment table.

## Delivery fee
`deliveryFeePoisha` is set by the server from the zone: `delivery.fees` setting (`IN_CITY` = In Sylhet, `OUTER_CITY` = Outer Sylhet), default 0, edited in admin Settings (`PUT /admin/config {deliveryFeesTaka:{IN_CITY,OUTER_CITY}}`). Charged for home delivery only; `totalPoisha = subtotalPoisha + deliveryFeePoisha`. The zone and fee are stored on the order.

## Staff (`/admin/*`)
| Call | ADMIN | MANAGER |
|---|---|---|
| `GET /admin/summary` (product counts, order counts by status/method, today, open, revenue, latest) | yes | yes |
| `GET /admin/products?q&category&status=active\|hidden\|noprice\|noimage`, `GET /admin/products/:id` | yes | yes |
| `POST /admin/products {nameBn,nameEn,categorySlug}` (created **hidden**) | yes | 403 |
| `PATCH /admin/products/:id` — names, `categorySlug`, `active`, `nameVerified`, `outerCityStatus` (`approved\|disabled\|pending_verification\|pending_confirmation\|null`), `content{…}`, `variants[]` (replace-all: `{id?,labelBn,pricePoisha,compareAtPoisha,stock,maxQty}`) | yes | 403 |
| `POST /admin/products/:id/image {dataBase64}`, `DELETE …/image` | yes | 403 |
| `POST /admin/inventory {outletId,variantId,quantity}` (counted on-hand at any outlet) | yes | 403 |
| `GET/POST /admin/categories`, `PATCH /admin/categories/:id` | yes | read only |
| `GET /admin/orders?status&method&q&page&limit`, `GET /admin/orders/:id` (adds `next[]`, `cancelReason`) | yes | yes |
| `PATCH /admin/orders/:id {status, reason?}`, `PATCH /admin/orders/:id/payment {paymentStatus}` | yes | 403 |
| `GET /admin/config`, `PUT /admin/config {hours:{open,close}, bulk:{minTotalQuantity,minTotalTaka}, deliveryFeesTaka?:{IN_CITY,OUTER_CITY}}` (saving clears the "placeholder" flag) | yes | read only |
| `GET /admin/outlets`, `PATCH /admin/outlets/:id`, `PUT /admin/outlets/:id/hours`, `PUT /admin/fulfilment-outlets {dispatchOutletId,collectionOutletId}` | yes | read only |
| `GET /admin/audit?entityType&entityId&limit` | yes | yes |

Variant `stock`: units available at the dispatch outlet; `null` = **stock not counted** (explicit choice; the variant is then never out of stock). A variant that is counted but has no stock row is **out of stock**. A variant with orders or stock history cannot be removed. Image upload: bytes decoded with `sharp` (JPEG/PNG/WebP only, SVG refused), ≤ 5 MB, re-encoded to WebP ≤ 1600 px, metadata stripped, random key, stored in S3-compatible storage (local disk in development only).

## Health
`GET /health/live` (process up), `GET /health/ready` (database reachable and migrated). No versions, hosts or secrets.

## Not in this phase
Coupons, saved addresses, customer self-cancel, SMS order notifications, account-deletion requests, any online payment. (Removed with the old design: areas, delivery slots, COD, riders.)
