> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# User Roles and Permissions

Status: Draft v0.1 — 2026-10-19

## 1. Principles

1. **Server-enforced.** Every protected endpoint declares a permission (`@RequirePermission('orders.confirm')`) and, for outlet data, resolves the outlet scope from the session — never from a client-supplied outlet id alone. Hiding UI is a convenience only.
2. **Least privilege.** Roles start minimal; extra permissions are granted per outlet assignment and capped by the role ceiling.
3. **Outlet isolation.** Outlet roles act only within outlets listed in their active `outlet_staff` assignments. Out-of-scope ids return `404`.
4. **Separation of duties.** The person who records COD cash collection (rider) is not the person who confirms its receipt (manager). Refunds need Super Admin.
5. **Everything sensitive is audited** (see §5).

## 2. Roles

| Role | Scope | Who | MFA |
|------|-------|-----|-----|
| `SUPER_ADMIN` | Global, all outlets | Business owner / head office | Required |
| `OUTLET_MANAGER` | Assigned outlet(s) | Outlet in-charge | Required |
| `OUTLET_STAFF` | Assigned outlet(s) | Counter/packing staff | Optional (configurable) |
| `DELIVERY_STAFF` | Assigned outlet(s), own deliveries only | Riders | Not required; device-bound session, short idle timeout |
| `CUSTOMER` | Own account only | Shoppers | Phone OTP |

Each staff user is assigned to exactly one outlet with one role (OPEN_DECISIONS C5, closed). Only Super Admin is cross-outlet.

## 3. Permission catalogue

Legend: ● allowed · ◐ allowed within own outlet scope · ○ own records only · — denied · ⚙ configurable grant (off by default)

### Catalogue and content
| Permission | Super Admin | Manager | Staff | Delivery | Customer |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `catalog.read_admin` (drafts, internal fields) | ● | ◐ | ◐ | — | — |
| `catalog.manage` (products, variants, categories, images) | ● | — | — | — | — |
| `catalog.publish` (approve content, make ACTIVE) | ● | — | — | — | — |
| `pricing.manage_global` | ● | — | — | — | — |
| `content.manage` (banners, collections, FAQ, policies) | ● | — | — | — | — |

### Outlets and staff
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `outlets.manage` (create, edit, pause) | ● | — | — | — | — |
| `outlets.read` | ● | ◐ | ◐ | ◐ (name/phone only) | — |
| `outlets.hours_manage` | ● | ◐ | — | — | — |
| `staff.manage_all` | ● | — | — | — | — |
| `staff.manage_outlet` (create/suspend Staff & Delivery at own outlet; cannot create Managers) | ● | ⚙ | — | — | — |
| `roles.manage` | ● | — | — | — | — |

### Inventory
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `inventory.read` | ● | ◐ | ◐ | — | — |
| `inventory.receive` | ● | ◐ | ⚙ | — | — |
| `inventory.adjust` (up/down with reason) | ● | ◐ | ⚙ | — | — |
| `inventory.write_off` | ● | ◐ | — | — | — |
| `inventory.thresholds` | ● | ◐ | — | — | — |
| `inventory.count` (start/complete reconciliation) | ● | ◐ | ⚙ start only | — | — |
| `inventory.transfer_request` | ● | ◐ | — | — | — |
| `inventory.transfer_approve` | ● | — | — | — | — |
| `inventory.transfer_receive` | ● | ◐ (destination) | ⚙ | — | — |

### Orders
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `orders.read` | ● | ◐ | ◐ | ○ assigned delivery fields only | ○ |
| `orders.confirm` / `orders.reject` | ● | ◐ | ⚙ | — | — |
| `orders.prepare` (PREPARING → READY) | ● | ◐ | ◐ | — | — |
| `orders.cancel` | ● | ◐ (before dispatch) | — | — | ○ (until CONFIRMED) |
| `orders.reschedule` | ● | ◐ | ⚙ | — | ○ request only |
| `orders.export_csv` | ● | ⚙ | — | — | — |
| `orders.view_customer_contact` | ● | ◐ | ◐ | ○ while assigned & active | ○ |

### Delivery
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `delivery.zones_manage` (areas, zones) | ● | — | — | — | — |
| `delivery.outlet_rules_manage` (fee, min order, COD per zone) | ● | ⚙ | — | — | — |
| `delivery.slots_manage` (templates, capacity, close slot) | ● | ◐ | — | — | — |
| `delivery.assign` | ● | ◐ | ⚙ | — | — |
| `delivery.update_status` | ● | ◐ | — | ○ own assigned | — |
| `delivery.record_attempt` | ● | ◐ | — | ○ own assigned | — |
| `delivery.upload_proof` | ● | ◐ | — | ⚙ ○ (if D7 approved) | — |

### Payments and money
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `payments.read` (status, amounts) | ● | ◐ | ◐ status only | — | ○ |
| `payments.read_raw_events` | ● | — | — | — | — |
| `payments.reconcile` | ● | — | — | — | — |
| `payments.refund` | ● | — | — | — | — |
| `cod.record_collection` | ● | — | — | ○ own deliveries | — |
| `cod.confirm_handover` | ● | ◐ | — | — | — |
| `cod.resolve_discrepancy` | ● | — | — | — | — |
| `coupons.manage` | ● | — | — | — | — |

### Reports, audit, settings
| Permission | SA | Mgr | Staff | Del | Cust |
|-----------|:-:|:-:|:-:|:-:|:-:|
| `reports.consolidated` | ● | — | — | — | — |
| `reports.outlet` | ● | ◐ | — | — | — |
| `audit.read` | ● | ◐ (own outlet entries) | — | — | — |
| `customers.privacy` (process account-deletion requests) | ● | — | — | — | — |
| `settings.global` | ● | — | — | — | — |
| `settings.outlet` | ● | ◐ | — | — | — |
| `notifications.configure` | ● | — | — | — | — |

### Customer self-service
Customers may: read/edit own profile; manage own addresses; view own carts, orders, payments (status only), tracking; reorder; request cancellation/reschedule; request data export/deletion. Every customer route filters by `user_id = session.user_id`.

## 4. Data access boundaries

| Data | Outlet A staff can see | Must never see |
|------|------------------------|----------------|
| Inventory | Outlet A rows | Outlet B rows (incl. via report filters or ids) |
| Orders | Orders with `outlet_id = A` | Outlet B orders; the same customer's orders at Outlet B |
| Customers | Name/phone/address **as snapshotted on Outlet A orders** | Customer account list, other addresses, order history elsewhere |
| Delivery | Outlet A deliveries and riders | Outlet B riders and assignments |
| Reports | Outlet A aggregates | Consolidated or Outlet B figures |
| Staff | Outlet A staff list (manager only) | Other outlets' staff |

**Delivery staff** see for each *currently assigned, not yet closed* delivery: order number, items (names/qty), recipient name, phone, address snapshot, slot, amount to collect if COD. After the delivery closes (+ configurable grace, default 2 h) contact details are hidden from the rider's view. Riders never see payment provider data, prices configuration, other riders' deliveries, or customer accounts.

**Super Admin** sees everything except secrets (gateway keys, password hashes, OTP codes, TOTP secrets), which no UI exposes.

## 5. Audited actions (minimum)

Login success/failure (staff), MFA enrol/reset, role/assignment changes, outlet create/edit/pause, product price change, publish/archive, all manual inventory actions, transfers, stock counts, slot/capacity changes, order confirm/reject/cancel/reschedule, delivery assignment and outcome, COD collection/handover/discrepancy, refunds, reconciliation actions, coupon changes, settings changes, CSV exports (who exported what filter).

## 6. Implementation notes

- Permission codes live in `packages/shared/permissions.ts`; seed migration inserts them; role→permission defaults seeded; `⚙` grants stored in `outlet_staff.extra_permissions` and validated against a per-role ceiling table in code.
- Guard order: `SessionGuard` → `MfaGuard` (for roles requiring MFA) → `PermissionGuard` → `OutletScopeGuard` (builds `AccessContext`).
- Role changes revoke the user's active sessions so new scope applies immediately.

## 7. Credential management (2026-10-21)

- Every staff member can change their own password (current password required; their other sessions end).
- `staff.manage_outlet` holders (Super Admin; managers only if granted) can deactivate, reactivate and reset the temporary password and/or two-factor of **outlet staff and riders** at their outlet. Managers' credentials can only be reset by a Super Admin. Nobody resets their own account this way. Every reset ends the person's sessions and is audited.
- Break-glass for any staff account (including Super Admin): `reset-mfa` CLI with database credentials (DEPLOYMENT_RUNBOOK §2.2), audited as `staff.mfa_reset_cli`.
- Stock counts: outlet staff with the optional `inventory.count` grant can start a count and enter quantities; only managers and the Super Admin can complete it.
- Transfers: dispatch needs `inventory.adjust` at the source outlet; receive needs `inventory.transfer_receive` at the destination; approval is Super Admin only.

