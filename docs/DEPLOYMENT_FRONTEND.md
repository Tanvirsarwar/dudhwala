# Frontend deployment (storefront + admin) and the API contract they expect

Status: **the frontend is deployment-ready; the backend-dependent features are simulated in the local demo.** Do not describe a deployment of only these two apps as a working shop: ordering, accounts, payments and notifications need the real API (see "What the real API must provide").

## Build facts
| | |
|---|---|
| Apps | `apps/web` (storefront), `apps/admin` (admin + manager) — two independent Next.js 16 apps (output `standalone`) |
| Shared code | `packages/shared` (business rules, i18n dictionary; **built to `dist/` by the app `build` script**), `packages/ui` (design tokens, theme + language switches; source-only) |
| Node / pnpm | Node 22+, pnpm 9.15.9 |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @dudhwala/web build` (admin: `@dudhwala/admin`). Run from the repository root so the workspace packages resolve |
| Start | `next start` (web :3000, admin :3001 by default) or the standalone server in `.next/standalone` |

## Environment variables
See `apps/web/.env.example` and `apps/admin/.env.example`. Summary:

| Variable | Where | Meaning |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | both, **required** | `/v1` (same-origin proxy, recommended) or a full API URL. The production build **fails** if it is missing |
| `API_PROXY_TARGET` | both | bare https origin the `/v1/*` proxy forwards to (same-origin mode) |
| `API_INTERNAL_URL` | web | server-side API URL for server-rendered pages (defaults to proxy target + `NEXT_PUBLIC_API_URL`) |
| `NEXT_PUBLIC_MEDIA_ORIGINS` | both | image CDN origins for the CSP |
| `NEXT_PUBLIC_ALLOW_INDEXING` | web | `true` only on the real public site |
| `NEXT_PUBLIC_STOREFRONT_URL` | admin | "View shop" links |
| `NEXT_PUBLIC_PREVIEW_LABEL` | both | staging banner |
| `NEXT_PUBLIC_DEMO_BRANDING` | both | **demo only; leave unset in production** |

No secrets belong in any `NEXT_PUBLIC_*` variable or in frontend code. No `127.0.0.1`/`localhost` is hard-coded in client code; the local demo supplies its addresses through `start-demo.sh` / `.bat`.

## Local demo vs production
| | Local demo (`start-demo.*`) | Production |
|---|---|---|
| API | `demo/mock-api` (Node, JSON file) on :4010 | the real NestJS API |
| `NEXT_PUBLIC_DEMO_BRANDING` | `1` | unset |
| Checkout | demo checkout (no login, simulated payment, orders saved in the mock API) | OTP login + real checkout (`RealCheckout` in `apps/web/app/checkout`) |
| Customer account | "My orders" for this browser only | OTP login, saved addresses, order history |
| Staff login | two hard-coded demo accounts | real accounts, MFA, audit log |
| Catalogue freshness | never cached | cached ~30 s (`serverGet`) |

## Production frontend checklist
1. Build the API first (separate phase) and publish it over HTTPS.
2. Create two projects (web, admin) from this repository root; set `NEXT_PUBLIC_API_URL=/v1` and `API_PROXY_TARGET=<api origin>` on both; leave demo variables unset.
3. Check the response headers (CSP, nosniff, frame-ancestors) in the deployed site.
4. Do **not** rely on the browser-side rules (`packages/shared/src/ordering.ts`) for security: the API must enforce eligibility, ordering hours, pickup lead time, bulk rules, prices, stock and payment state.
5. Remove or replace the demo-only components listed in `docs/PHASE2_INTEGRATION.md`.

## What the real API must provide
The exact calls the storefront and admin use are listed in `docs/ADMIN_AND_API_CONTRACT.md` (public catalogue/cart/orders/config, staff area, roles). Summary of the storefront contract: `GET /catalog/categories|products|products/:slug`, `GET /config`, cart endpoints, `POST /orders`, `GET /orders/:id` (owner only), `GET /orders/:id/status`, `GET /outlets`, plus the production-only OTP/account/payment calls used by `RealCheckout`, `/account` and `/orders/[id]`.
