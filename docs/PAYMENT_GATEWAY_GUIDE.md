# Payment Gateway Onboarding and Reconciliation Guide

Status: v1.0 — 2026-10-21. Gateway choice is still a business decision (OPEN_DECISIONS E1). The platform ships two adapters behind one interface (`apps/api/src/payments/gateway.ts`):

| `PAYMENTS_PROVIDER` | Use | Notes |
|---|---|---|
| `fake` | Development, demos, automated tests; staging only with `ALLOW_PAYMENT_SIMULATOR=true` | Built-in simulator with its own hosted page, signed asynchronous IPNs and status API. Refused in production. |
| `sslcommerz` | Staging (sandbox) and production (live) | SSLCOMMERZ hosted checkout (cards, bKash, Nagad, Rocket and internet banking, as enabled on the merchant account). |

Another gateway (for example bKash Tokenized Checkout or Nagad direct) can be added as a new adapter implementing `initiate`, `verify`, `parseCallback`, `refund` and optionally `refundStatus`; checkout, webhooks, reconciliation and refunds do not change.

## 1. How a payment becomes "paid" (all providers)

1. Customer places an order with online payment → order `PENDING_PAYMENT`, stock and slot held for `payments.holdMinutes` (default 15).
2. `POST /v1/payments/:orderId/initiate` → the API creates the gateway session with the amount **from the database** and redirects the customer to the gateway's hosted page.
3. The gateway notifies the API (IPN). The API stores the raw event (duplicates ignored), checks the signature, then **queries the gateway server-to-server** for the transaction.
4. Only if the query says success **and** our transaction id, the amount and currency `BDT` match, the payment becomes `PAID` and the order `PLACED`.
5. The customer's browser return carries no authority; the storefront return page polls the API.
6. A job runs every minute: it re-checks payments pending > 10 minutes and, before releasing an expired hold, asks the gateway one last time.
7. Late success after expiry: the order is re-reserved if stock and slot are still free, otherwise a refund request is created automatically.
8. A second successful capture for an already paid order is recorded truthfully, flagged `duplicateCapture`, and a refund request is created.

Refunds never happen automatically: requests wait for a Super Admin in **পেমেন্ট ও রিফান্ড**.

## 2. SSLCOMMERZ onboarding checklist

Facts below come from SSLCOMMERZ's v4 developer documentation (sandbox-gw.sslcommerz.com/doc/v4: Order Validation, IPN, Order Query) and its official Node library (`sslcommerz-lts` 1.2.0, github.com/sslcommerz/SSLCommerz-NodeJS), checked on 2026-10-21. Confirm fees, settlement time and enabled payment methods with SSLCOMMERZ during onboarding; this project does not assume any of them.

1. **Sandbox account**: register a sandbox store at SSLCOMMERZ's developer portal. You receive a sandbox Store ID and Store Password.
2. **Staging configuration** (secrets in the hosting platform):
   ```
   PAYMENTS_PROVIDER=sslcommerz
   SSLCOMMERZ_STORE_ID=<sandbox store id>
   SSLCOMMERZ_STORE_PASSWORD=<sandbox store password>
   SSLCOMMERZ_LIVE=false
   API_PUBLIC_URL=https://api.staging.<domain>
   ```
3. **IPN URL** in the SSLCOMMERZ merchant panel: `https://api.<domain>/v1/webhooks/payments/sslcommerz` (staging: `https://api.staging.<domain>/…`). The API also sends this URL with every session.
4. Success/fail/cancel URLs are sent per session by the API (`/v1/webhooks/payments/sslcommerz/return?order=…`); nothing to configure.
5. **Test on staging**: place online orders and complete them with SSLCOMMERZ sandbox test instruments; check that an order becomes paid only after the IPN/verification, that a cancelled payment can be retried or switched to COD, and that a refund executes (see §4).
6. **Merchant application** (live): expect to provide business documents (typically trade licence, TIN/BIN, bank account details and the owner's NID — confirm the current list with SSLCOMMERZ) and a live website showing products, prices, contact details and the terms, privacy, refund and delivery policies. Publish the policy pages (**ব্যানার ও পেজ**) before applying (OPEN_DECISIONS A6, E2).
7. **Production configuration** after approval:
   ```
   PAYMENTS_PROVIDER=sslcommerz
   SSLCOMMERZ_STORE_ID=<live store id>
   SSLCOMMERZ_STORE_PASSWORD=<live store password>
   SSLCOMMERZ_LIVE=true
   ```
   The API refuses `SSLCOMMERZ_LIVE=true` outside production and refuses the sandbox in production.
8. Switch on online payment: **সেটিংস → payments.online.enabled = true**.
9. **Live test**: one low-value real order paid by card or mobile wallet, then a refund of it executed from the admin. Record both in the runbook log.
10. **Confirm with SSLCOMMERZ**: the IPN `verify_sign` scheme. The adapter implements the scheme from SSLCOMMERZ's published PHP integration (md5 over the sorted `verify_key` fields plus md5 of the store password). If SSLCOMMERZ's answer differs, adjust `SslCommerzGateway.verifySign` — payment safety does not depend on it, because every IPN is followed by the server-side transaction query.

### What the adapter sends and checks

| Step | Endpoint (base `https://sandbox.sslcommerz.com` or `https://securepay.sslcommerz.com`) | Key fields |
|---|---|---|
| Create session | `POST /gwprocess/v4/api.php` | `total_amount` (taka, 2 decimals from DB poisha), `currency=BDT`, `tran_id` = our `merchantTranId` (`DW-…-n`), `ipn_url`, `success/fail/cancel_url`, `shipping_method=NO`, `product_profile=physical-goods`, `cus_phone`. Response must be `status=SUCCESS` with a `GatewayPageURL` on `*.sslcommerz.com`. |
| Verify | `GET /validator/api/merchantTransIDvalidationAPI.php?tran_id=…` | Uses the element with `status` VALID/VALIDATED; checks `tran_id`, `amount`, `currency_type`/`currency` = BDT. `bank_tran_id` is stored as the provider transaction id. `risk_level=1` is logged for review. |
| Refund | `GET …merchantTransIDvalidationAPI.php?bank_tran_id=…&refund_amount=…&refund_remarks=…&refe_id=…` | Accepted refunds are `SUBMITTED`; the minute job polls `refund_ref_id` until `refunded` (→ SUCCEEDED, payment REFUNDED/PARTIALLY_REFUNDED) or failed. |

Store password is sent only server-to-server and never logged; gateway payloads are stored with card-, password-, token- and signature-like fields removed.

## 3. Daily reconciliation (Super Admin or accountant)

Every day, for the previous day (Asia/Dhaka):

1. Download the gateway's settlement/transaction report from the merchant panel.
2. In the admin: **রিপোর্ট → sales** for the same date range (CSV), and **পেমেন্ট ও রিফান্ড → reconciliation exceptions**.
3. Match by transaction id (`DW-…` = our `merchantTranId`; the gateway's bank transaction id is shown on the payment).
4. Check: every gateway success is `PAID` in the admin; every admin `PAID` online payment appears in the gateway report; refunds match; totals = gross − refunds − gateway fees = settlement.
5. Work the exceptions queue:
   - **Pending > 10 min**: press re-verify; if the gateway shows success it becomes paid.
   - **Amount mismatch**: do not mark paid. Contact the gateway; refund through the gateway if the customer was charged.
   - **Duplicate capture / paid after expiry or cancellation**: execute the auto-created refund after checking.
6. Record "reconciled, differences: none / list" with date and name (a shared log or the runbook log).

## 4. Refunds

1. Requests are created automatically (customer cancels a paid order, outlet rejects, duplicate capture, paid after expiry) — or by a Super Admin.
2. Super Admin reviews in **পেমেন্ট ও রিফান্ড** and executes. Only verified online payments can be refunded; a refund can never exceed what was paid minus earlier refunds.
3. Simulator: instant. SSLCOMMERZ: `SUBMITTED` until the gateway reports `refunded` (checked every minute); the customer gets an SMS when it completes (if the `REFUNDED` SMS event is on).
4. A failed refund stays visible as `FAILED`; resolve it with the gateway and record what was done.

## 5. Cash on delivery

COD is a separate payment method: eligibility per outlet zone rule (on/off, maximum order value) and an optional block after repeated failed deliveries (`cod.failedDeliveryBlockThreshold`). A COD order becomes `PAID` only when the outlet manager confirms the cash handover; delivery alone never marks anything paid. Discrepancies are resolved by the Super Admin. See OPERATIONS_GUIDE §2.3.

## 6. Incident switches

- Gateway outage or misbehaviour: **সেটিংস → payments.online.enabled = false** (instant; COD continues where eligible).
- Suspected fraud wave: lower the COD maximum per zone, enable the failed-delivery COD block, and review `risk_level` warnings in the API logs.
