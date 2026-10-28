# Admin panel and API contract (V2.6 demo)

This is what the rebuilt admin (`apps/admin`) and the storefront expect from the API. The demo implements it in `demo/mock-api/server.mjs` (one file, JSON file storage). The real backend (NestJS + PostgreSQL) should implement the same behaviour; items marked **MUST** are things the demo only does in the browser or skips.

## Roles
| Role | Login page | Can do |
|---|---|---|
| ADMIN | `/login` | everything below |
| MANAGER | `/manager/login` | all `GET /admin/*`; every write returns `403 READ_ONLY` |

Each account signs in only on its own page (the other page answers with the same "wrong email or password" message). Session cookie: HttpOnly, SameSite=Strict. All writes need the `x-csrf-token` header. **MUST (real backend):** hashed passwords, rate limiting, MFA for ADMIN, audit log of every admin write, real session expiry. The demo has two hard-coded accounts.

## Public (storefront)
| Call | Purpose |
|---|---|
| `GET /catalog/categories`, `/catalog/products`, `/catalog/products/:slug` | only `active` products in `active` categories; `outerCityStatus`, prices (`null` = not set), stock (`null` = not counted) |
| `GET /config` | `{hours:{openMinute,closeMinute}, bulk:{minTotalQuantity,minTotalPoisha,isPlaceholder}}` |
| `GET/PUT /cart...` | cart (demo: in memory) |
| `POST /orders` | create an order. Body: `method`, `zone`, `lines:[{variantId,quantity}]`, `address` (home) or `contact` (pickup/bulk), `outletId`+`pickupAt` (pickup), `payment` (bulk). The server prices the lines itself |
| `GET /orders/:id/status` | `{id,status,method}` only (no personal data) |

`POST /orders` in the demo checks: product exists and is active, quantity within stock and max, Outer City eligibility for home delivery, bulk threshold (a bulk cart cannot use home delivery/pickup; a non-bulk cart cannot use BULK_ORDER), bulk prepayment flag. **MUST (real backend):** also enforce ordering hours, pickup lead time and outlet hours, payment confirmation from the provider, stock reservation, idempotency, and require login or an unguessable order token (the demo's order id `DEMO-1001` is guessable, which is why the public status call exposes no personal data).

## Staff (`/admin/*`)
| Call | ADMIN | MANAGER |
|---|---|---|
| `GET /admin/summary` (counts: products, orders by status/method, latest orders) | yes | yes |
| `GET /admin/products?q&category&status=active\|hidden\|noprice\|noimage`, `GET /admin/products/:id` | yes | yes |
| `POST /admin/products` (names + category), `PATCH /admin/products/:id` (names, category, `active`, `nameVerified`, `outerCityStatus`, `content{...}`, `variants[]` replace-all) | yes | 403 |
| `POST /admin/products/:id/image` `{dataBase64}`, `DELETE .../image` | yes | 403 |
| `GET /admin/categories`, `POST`, `PATCH /admin/categories/:id` | yes | read |
| `GET /admin/orders?status&method&q`, `GET /admin/orders/:id` | yes | yes |
| `PATCH /admin/orders/:id` `{status}` | yes | 403 |
| `GET/PUT /admin/config` | yes | read |
| `POST /admin/reset` (demo only; drop in the real backend) | yes | 403 |

Money is integer poisha everywhere. Variant: `{id,labelBn,pricePoisha|null,compareAtPoisha|null,stock|null,maxQty}`. Validation: whole numbers only, old price must be higher than price, 1-20 variants, text lengths capped.

Image upload: type is decided from the file's own bytes (JPEG, PNG, WebP only), 5 MB cap, stored as `<slug>.<ext>` and served with `X-Content-Type-Options: nosniff`. **MUST (real backend):** object storage (S3-compatible), re-encode/resize, virus scan if accepting from many staff, never serve user files from the app origin with a guessable path if images are private.

## Order status (demo)
Home delivery: PLACED -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED. Pickup: PICKUP_REQUESTED -> PREPARING -> READY_FOR_PICKUP -> PICKED_UP. Bulk: PREPAID_SIMULATED -> PREPARING -> READY_FOR_COLLECTION -> COLLECTED. Any live order can be CANCELLED; finished/cancelled orders are locked; statuses only move forward. The customer sees pickup/collection as confirmed only at READY. The shared definitions are in `packages/shared/src/ordering.ts` (`ORDER_STATUS_FLOW`, labels).

## Where the admin code is
`apps/admin/app/(panel)/*` (dashboard, products, categories, orders, settings), `apps/admin/app/login` + `app/manager/login`, `lib/session.tsx` (role, `canEdit`), `components/shell.tsx` (navigation per role). The previous staff screens (delivery slots, coupons, payments, stock counts, transfers, rider app...) belong to the real backend design and were removed from this demo app; they remain in git history on `main`.
