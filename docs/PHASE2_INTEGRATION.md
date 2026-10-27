# Phase 2 integration points (V2.5 demo ordering)

V2.5 runs the whole ordering experience in the browser against a mock API. Nothing below is real enforcement.
**Frontend filtering and validation are a demo convenience, not security.** The backend must re-check every rule on every cart and order.

## Where each rule lives today

| Rule | Code (single source) | Used by |
|---|---|---|
| Zone eligibility (In City / Outer City) | `ELIGIBILITY_RULES`, `zoneEligibility()` in `packages/shared/src/ordering.ts` | catalogue filter, product page, cart revalidation, checkout validation |
| Delivery promise (24 h / 1-2 days) | `DELIVERY_ESTIMATE` (same file), `ETA_TEXT` in `apps/web/components/zone-bar.tsx` | zone strip, product page, checkout |
| Ordering hours 10:00-22:00 Asia/Dhaka | `ORDERING_HOURS`, `orderingStatus(now)` | zone strip chip, checkout block |
| Express pickup lead time (>= 60 min) and slots | `PICKUP_RULES`, `earliestPickup`, `pickupSlots`, `validatePickup` | checkout |
| Bulk thresholds and collection point | `BULK_CONFIG`, `bulkStatus`, `availableFulfilments` | cart notice, checkout |
| Checkout validation (all of the above + address) | `validateCheckout()` returning issue codes | demo checkout, demo order service |
| Customer messages (bilingual) | `apps/web/lib/demo/messages.ts` + `EN_DICT` in `packages/shared/src/i18n-dict.ts` | UI |

The functions are pure (no UI, no network, explicit time zone, `now` passed in), so the NestJS API can import `@dudhwala/shared` and run the same checks server-side.

## Types

`packages/shared/src/ordering.ts` exports `DeliveryZone`, `FulfilmentMethod`, `OuterCityStatus`, `DemoPaymentState`, `CheckoutInput`, `Issue`/`IssueCode`. Web-side order types are in `apps/web/lib/services/types.ts` (`DemoOrder`, `DemoOrderStatus`, `Outlet`, `OrderService`, `OutletService`). Catalogue and cart shapes are in `apps/web/lib/api.ts` (`ProductCardData`, `CartView`; `pricePoisha` may be `null` = not supplied yet).

## Service boundary

UI code calls only `apps/web/lib/services/index.ts`:

- `orderService` -> **replace** `lib/services/demo-orders.ts` (browser `localStorage` key `dw.demo.orders`) with API calls (`POST /orders`, `GET /orders`). Keep the `OrderService` shape or adapt `components/demo-checkout.tsx` and `app/demo-orders/page.tsx`.
- `outletService` -> `lib/services/outlets.ts` calls the mock-only `GET /v1/outlets`; point it at the real outlets endpoint.

## Files and data to replace in Phase 2

| Demo piece | Replace with |
|---|---|
| `demo/mock-api/*` (server, `data.mjs`, `catalogue.json`) | the real NestJS API and PostgreSQL catalogue |
| `catalogue.json` fields `outerCity` / `nameVerified` | product attribute (e.g. `outer_city_status`) editable in the admin; remove `pending_*` once the owner confirms |
| `prices`, `stock` = `null` | the shop's product master (prices, pack sizes/variants, stock per outlet) |
| `components/demo-checkout.tsx` (no login, no payment) | the real OTP-login checkout in `app/checkout/page.tsx` (already in the repo as `RealCheckout`) extended with zone, pickup and bulk |
| `DemoPaymentState` simulated payment | the real payment provider flow (`packages/shared/src/payment-state.ts`) |
| `dw.demo.zone`, `dw.demo.orders` (localStorage) | server-side cart/zone/order state |
| Bulk collection `BULK_CONFIG.collectionBranch.outletId = null` | the real Modina Market Branch outlet id |
| `BULK_CONFIG` thresholds (placeholders) | owner-approved quantity and amount (stored as settings) |
| `PICKUP_RULES.hours` (= ordering hours) | each outlet's real opening hours |
| `NEXT_PUBLIC_DEMO_BRANDING` gates | remove once the demo pages are no longer needed |

## Backend checks the API must add

1. Reject cart lines / orders whose product fails `zoneEligibility` for the order's zone.
2. Reject orders outside the ordering hours (clock on the server, `Asia/Dhaka`).
3. Enforce pickup lead time and outlet hours.
4. Classify bulk orders by the configured thresholds and refuse delivery / express pickup for them; require a confirmed prepayment before accepting.
5. Never trust client-sent prices, totals, zone or status.
