# API routes (generated)

Generated from the controller sources by `apps/api/scripts/routes.mjs`. Do not edit by hand; regenerate after changing routes.
Access: `public` = no login; `customer` = customer session; a permission code = staff session with that permission (and TOTP when the role requires it). Outlet-scoped routes also check that the outlet in the path belongs to the caller (404 otherwise).

Routes: 151

| Method | Path | Access | Source |
|--------|------|--------|--------|
| GET | `/v1/admin/areas` | `outlets.read` | delivery/delivery-admin.controller.ts |
| POST | `/v1/admin/areas` | `delivery.zones_manage` | delivery/delivery-admin.controller.ts |
| PATCH | `/v1/admin/areas/:id` | `delivery.zones_manage` | delivery/delivery-admin.controller.ts |
| GET | `/v1/admin/audit` | `audit.read` | finance/finance.controller.ts |
| GET | `/v1/admin/banners` | `content.manage` | content/content.controller.ts |
| POST | `/v1/admin/banners` | `content.manage` | content/content.controller.ts |
| PATCH | `/v1/admin/banners/:id` | `content.manage` | content/content.controller.ts |
| GET | `/v1/admin/categories` | `catalog.read_admin` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/categories` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| PATCH | `/v1/admin/categories/:id` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/cod/:id/confirm-handover` | `cod.confirm_handover` | orders/orders-admin.controller.ts |
| POST | `/v1/admin/cod/:id/resolve` | `cod.resolve_discrepancy` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/collections` | `content.manage` | content/content.controller.ts |
| POST | `/v1/admin/collections` | `content.manage` | content/content.controller.ts |
| PUT | `/v1/admin/collections/:id` | `content.manage` | content/content.controller.ts |
| GET | `/v1/admin/coupons` | `coupons.manage` | finance/finance.controller.ts |
| POST | `/v1/admin/coupons` | `coupons.manage` | finance/finance.controller.ts |
| PATCH | `/v1/admin/coupons/:id` | `coupons.manage` | finance/finance.controller.ts |
| GET | `/v1/admin/dashboard` | `orders.read` | finance/finance.controller.ts |
| GET | `/v1/admin/orders` | `orders.read` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/orders/:orderId` | `orders.read` | orders/orders-admin.controller.ts |
| POST | `/v1/admin/orders/:orderId/assign-rider` | `delivery.assign` | orders/orders-admin.controller.ts |
| POST | `/v1/admin/orders/:orderId/reschedule` | `orders.reschedule` | orders/orders-admin.controller.ts |
| POST | `/v1/admin/orders/:orderId/transition` | `orders.read` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/outlets` | `outlets.read` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets` | `outlets.manage` | outlets/outlets.controller.ts |
| GET | `/v1/admin/outlets/:outletId` | `outlets.read` | outlets/outlets.controller.ts |
| PATCH | `/v1/admin/outlets/:outletId` | `outlets.manage` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets/:outletId/closures` | `outlets.hours_manage` | outlets/outlet-hours.controller.ts |
| DELETE | `/v1/admin/outlets/:outletId/closures/:date` | `outlets.hours_manage` | outlets/outlet-hours.controller.ts |
| GET | `/v1/admin/outlets/:outletId/cod` | `cod.confirm_handover` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/hours` | `outlets.read` | outlets/outlet-hours.controller.ts |
| PUT | `/v1/admin/outlets/:outletId/hours` | `outlets.hours_manage` | outlets/outlet-hours.controller.ts |
| GET | `/v1/admin/outlets/:outletId/inventory` | `inventory.read` | inventory/inventory.controller.ts |
| PATCH | `/v1/admin/outlets/:outletId/inventory/:variantId` | `inventory.thresholds` | inventory/inventory.controller.ts |
| POST | `/v1/admin/outlets/:outletId/inventory/adjust` | `inventory.adjust` | inventory/inventory.controller.ts |
| GET | `/v1/admin/outlets/:outletId/inventory/movements` | `inventory.read` | inventory/inventory.controller.ts |
| POST | `/v1/admin/outlets/:outletId/inventory/receive` | `inventory.receive` | inventory/inventory.controller.ts |
| POST | `/v1/admin/outlets/:outletId/inventory/write-off` | `inventory.write_off` | inventory/inventory.controller.ts |
| GET | `/v1/admin/outlets/:outletId/orders` | `orders.read` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/picklist` | `orders.prepare` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/riders` | `delivery.assign` | orders/orders-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/settings` | `settings.outlet` | settings/settings.controller.ts |
| PUT | `/v1/admin/outlets/:outletId/settings/:key` | `settings.outlet` | settings/settings.controller.ts |
| GET | `/v1/admin/outlets/:outletId/slot-templates` | `outlets.read` | delivery/delivery-admin.controller.ts |
| POST | `/v1/admin/outlets/:outletId/slot-templates` | `delivery.slots_manage` | delivery/delivery-admin.controller.ts |
| PATCH | `/v1/admin/outlets/:outletId/slot-templates/:id` | `delivery.slots_manage` | delivery/delivery-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/slots` | `outlets.read` | delivery/delivery-admin.controller.ts |
| PATCH | `/v1/admin/outlets/:outletId/slots/:slotId` | `delivery.slots_manage` | delivery/delivery-admin.controller.ts |
| POST | `/v1/admin/outlets/:outletId/slots/generate` | `delivery.slots_manage` | delivery/delivery-admin.controller.ts |
| GET | `/v1/admin/outlets/:outletId/staff` | `outlets.read` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets/:outletId/staff` | `staff.manage_outlet` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets/:outletId/staff/:assignmentId/activate` | `staff.manage_outlet` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets/:outletId/staff/:assignmentId/deactivate` | `staff.manage_outlet` | outlets/outlets.controller.ts |
| POST | `/v1/admin/outlets/:outletId/staff/:assignmentId/reset-credentials` | `staff.manage_outlet` | outlets/outlets.controller.ts |
| GET | `/v1/admin/outlets/:outletId/stock-counts` | `inventory.read` | inventory/stock-counts.controller.ts |
| POST | `/v1/admin/outlets/:outletId/stock-counts` | `inventory.count` | inventory/stock-counts.controller.ts |
| GET | `/v1/admin/outlets/:outletId/stock-counts/:countId` | `inventory.read` | inventory/stock-counts.controller.ts |
| POST | `/v1/admin/outlets/:outletId/stock-counts/:countId/cancel` | `inventory.count` | inventory/stock-counts.controller.ts |
| POST | `/v1/admin/outlets/:outletId/stock-counts/:countId/complete` | `inventory.count` | inventory/stock-counts.controller.ts |
| PUT | `/v1/admin/outlets/:outletId/stock-counts/:countId/lines` | `inventory.count` | inventory/stock-counts.controller.ts |
| GET | `/v1/admin/outlets/:outletId/zone-rules` | `outlets.read` | delivery/delivery-admin.controller.ts |
| PUT | `/v1/admin/outlets/:outletId/zone-rules/:zoneId` | `delivery.outlet_rules_manage` | delivery/delivery-admin.controller.ts |
| GET | `/v1/admin/pages` | `content.manage` | content/content.controller.ts |
| PUT | `/v1/admin/pages/:slug` | `content.manage` | content/content.controller.ts |
| GET | `/v1/admin/payments` | `payments.reconcile` | finance/finance.controller.ts |
| GET | `/v1/admin/payments/:id` | `payments.read_raw_events` | finance/finance.controller.ts |
| POST | `/v1/admin/payments/:id/verify` | `payments.reconcile` | finance/finance.controller.ts |
| GET | `/v1/admin/privacy-requests` | `customers.privacy` | customers/privacy.controller.ts |
| POST | `/v1/admin/privacy-requests/:id/process` | `customers.privacy` | customers/privacy.controller.ts |
| POST | `/v1/admin/product-images/:imageId/delete` | `catalog.manage` | content/content.controller.ts |
| GET | `/v1/admin/products` | `catalog.read_admin` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/products` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| GET | `/v1/admin/products/:id` | `catalog.read_admin` | catalog/catalog-admin.controller.ts |
| PATCH | `/v1/admin/products/:id` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/products/:id/archive` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/products/:id/images` | `catalog.manage` | content/content.controller.ts |
| POST | `/v1/admin/products/:id/publish` | `catalog.publish` | catalog/catalog-admin.controller.ts |
| POST | `/v1/admin/products/:id/variants` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| GET | `/v1/admin/reconciliation/exceptions` | `payments.reconcile` | finance/finance.controller.ts |
| POST | `/v1/admin/refunds/:id/execute` | `payments.refund` | finance/finance.controller.ts |
| GET | `/v1/admin/reports/cod` | `reports.outlet` | finance/finance.controller.ts |
| GET | `/v1/admin/reports/delivery` | `reports.outlet` | finance/finance.controller.ts |
| GET | `/v1/admin/reports/inventory` | `reports.outlet` | finance/finance.controller.ts |
| GET | `/v1/admin/reports/sales` | `reports.outlet` | finance/finance.controller.ts |
| GET | `/v1/admin/settings` | `settings.global` | settings/settings.controller.ts |
| PUT | `/v1/admin/settings/:key` | `settings.global` | settings/settings.controller.ts |
| GET | `/v1/admin/transfers` | `inventory.read` | inventory/transfers.controller.ts |
| POST | `/v1/admin/transfers` | `inventory.transfer_request` | inventory/transfers.controller.ts |
| POST | `/v1/admin/transfers/:id/approve` | `inventory.transfer_approve` | inventory/transfers.controller.ts |
| POST | `/v1/admin/transfers/:id/cancel` | `inventory.transfer_request` | inventory/transfers.controller.ts |
| POST | `/v1/admin/transfers/:id/dispatch` | `inventory.adjust` | inventory/transfers.controller.ts |
| POST | `/v1/admin/transfers/:id/receive` | `inventory.transfer_receive` | inventory/transfers.controller.ts |
| GET | `/v1/admin/transfers/outlets` | `inventory.transfer_request` | inventory/transfers.controller.ts |
| PATCH | `/v1/admin/variants/:id` | `catalog.manage` | catalog/catalog-admin.controller.ts |
| GET | `/v1/admin/zones` | `outlets.read` | delivery/delivery-admin.controller.ts |
| POST | `/v1/admin/zones` | `delivery.zones_manage` | delivery/delivery-admin.controller.ts |
| PUT | `/v1/admin/zones/:id` | `delivery.zones_manage` | delivery/delivery-admin.controller.ts |
| GET | `/v1/auth/csrf` | public | auth/auth.controller.ts |
| POST | `/v1/auth/logout` | public | auth/auth.controller.ts |
| POST | `/v1/auth/otp/request` | public | auth/auth.controller.ts |
| POST | `/v1/auth/otp/verify` | public | auth/auth.controller.ts |
| POST | `/v1/auth/staff/login` | public | auth/auth.controller.ts |
| POST | `/v1/auth/staff/mfa` | staff (MFA not yet required) | auth/auth.controller.ts |
| POST | `/v1/auth/staff/mfa/confirm` | staff (MFA not yet required) | auth/auth.controller.ts |
| POST | `/v1/auth/staff/mfa/enroll` | staff (MFA not yet required) | auth/auth.controller.ts |
| POST | `/v1/auth/staff/password` | any staff | auth/auth.controller.ts |
| GET | `/v1/cart` | public (anonymous or customer cart) | cart/cart.controller.ts |
| PUT | `/v1/cart/area` | public (anonymous or customer cart) | cart/cart.controller.ts |
| DELETE | `/v1/cart/coupon` | public (anonymous or customer cart) | cart/cart.controller.ts |
| PUT | `/v1/cart/coupon` | public (anonymous or customer cart) | cart/cart.controller.ts |
| PUT | `/v1/cart/items/:variantId` | public (anonymous or customer cart) | cart/cart.controller.ts |
| GET | `/v1/catalog/categories` | public | catalog/catalog-public.controller.ts |
| GET | `/v1/catalog/products` | public | catalog/catalog-public.controller.ts |
| GET | `/v1/catalog/products/:slug` | public | catalog/catalog-public.controller.ts |
| POST | `/v1/checkout/orders` | customer | checkout/checkout.controller.ts |
| POST | `/v1/checkout/price` | customer | checkout/checkout.controller.ts |
| POST | `/v1/checkout/quote` | customer | checkout/checkout.controller.ts |
| GET | `/v1/content/home` | public | content/content.controller.ts |
| GET | `/v1/content/pages/:slug` | public | content/content.controller.ts |
| GET | `/v1/delivery/areas` | public | catalog/catalog-public.controller.ts |
| GET | `/v1/delivery/check` | public | catalog/catalog-public.controller.ts |
| GET | `/v1/dev/sms` | public | auth/sms.ts |
| GET | `/v1/health/live` | public | health/health.controller.ts |
| GET | `/v1/health/ready` | public | health/health.controller.ts |
| GET | `/v1/me` | public | auth/auth.controller.ts |
| GET | `/v1/me/addresses` | customer | customers/addresses.controller.ts |
| POST | `/v1/me/addresses` | customer | customers/addresses.controller.ts |
| DELETE | `/v1/me/addresses/:id` | customer | customers/addresses.controller.ts |
| PATCH | `/v1/me/addresses/:id` | customer | customers/addresses.controller.ts |
| GET | `/v1/me/orders` | customer | checkout/checkout.controller.ts |
| GET | `/v1/me/orders/:id` | customer | checkout/checkout.controller.ts |
| POST | `/v1/me/orders/:id/cancel` | customer | checkout/checkout.controller.ts |
| POST | `/v1/me/orders/:id/reorder` | customer | checkout/checkout.controller.ts |
| GET | `/v1/me/privacy` | customer | customers/privacy.controller.ts |
| POST | `/v1/me/privacy/delete-request` | customer | customers/privacy.controller.ts |
| GET | `/v1/me/privacy/export` | customer | customers/privacy.controller.ts |
| GET | `/v1/me/profile` | customer | content/content.controller.ts |
| PATCH | `/v1/me/profile` | customer | content/content.controller.ts |
| GET | `/v1/media/:folder/:file` | public | media/media.ts |
| GET | `/v1/orders/:id/payment-status` | customer | checkout/checkout.controller.ts |
| POST | `/v1/payments/:orderId/initiate` | customer | checkout/checkout.controller.ts |
| POST | `/v1/payments/:orderId/switch-to-cod` | customer | checkout/checkout.controller.ts |
| GET | `/v1/payments/simulator/:sessionId` | public | payments/fake-gateway.ts |
| POST | `/v1/payments/simulator/:sessionId/complete` | public | payments/fake-gateway.ts |
| GET | `/v1/rider/deliveries` | `delivery.update_status` | orders/rider.controller.ts |
| POST | `/v1/rider/deliveries/:id/complete` | `delivery.record_attempt` | orders/rider.controller.ts |
| POST | `/v1/rider/deliveries/:id/fail` | `delivery.record_attempt` | orders/rider.controller.ts |
| POST | `/v1/rider/deliveries/:id/status` | `delivery.update_status` | orders/rider.controller.ts |
| POST | `/v1/webhooks/payments/:provider` | public | checkout/checkout.controller.ts |
| POST | `/v1/webhooks/payments/sslcommerz/return` | public | checkout/checkout.controller.ts |
