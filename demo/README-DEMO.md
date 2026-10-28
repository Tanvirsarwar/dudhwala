# Dudhwala — local demo (V2.7)

A runnable **frontend demo** of the Dudhwala storefront and admin/manager panels on your own computer. It uses the project's real Next.js apps with a small **mock API** (`demo/mock-api`, plain Node, saves to a JSON file).

> Product **names** and delivery-eligibility marks come from the shop's real printed lists. **Prices, pack sizes, stock and photos were not supplied**, so they are empty ("Price to be announced") until the admin enters them. Orders, outlets, accounts and payments are **demo/simulated**. This is not a production e-commerce system: it needs the backend phase (see "What is simulated").

## Requirements
- **Node.js 22+** and **pnpm 9.15.9** (`corepack enable` is enough on most systems).
- Internet **only on the first run** (downloads dependencies). About 1.5 GB disk and a few minutes for the first build.

## Start

### NixOS
```bash
unzip dudhwala-premium-local-demo-v2.7.zip
cd dudhwala-premium-local-demo-v2.7
chmod +x start-demo.sh start-demo-nixos.sh
./start-demo-nixos.sh          # nix-shell: nodejs_22 + pnpm + steam-run (needed for the prebuilt native binaries)
```
If `steam-run` does not work on your machine, add `programs.nix-ld.enable = true;` to `configuration.nix`, rebuild, then run `./start-demo.sh` inside `nix-shell -p nodejs_22 pnpm`. *The NixOS path could not be run in the environment where this package was built; the script is a thin wrapper around `start-demo.sh`, which was verified.*

### Linux / macOS
```bash
unzip dudhwala-premium-local-demo-v2.7.zip && cd dudhwala-premium-local-demo-v2.7
chmod +x start-demo.sh && ./start-demo.sh
```
### Windows
Unzip, then double-click **`start-demo.bat`** (or run it in Command Prompt). *Reviewed but not executed on Windows when this package was built.*

The first run installs dependencies and builds both sites (a few minutes); later runs start in seconds. Wait for **"Dudhwala DEMO is running"**.

### Stop
Linux/macOS/NixOS: press **Ctrl+C** in the terminal (all three processes stop). Windows: run `stop-demo.bat` or close the three "Dudhwala demo" windows.

## Addresses and demo logins (127.0.0.1 only)
| What | URL | Login |
|---|---|---|
| Storefront | http://127.0.0.1:3100 | none (customers order without logging in) |
| Admin | http://127.0.0.1:3101 | `admin@demo.local` / `demo1234` |
| Manager (view only) | http://127.0.0.1:3101/manager/login | `manager@demo.local` / `manager1234` |
| Mock API check | http://127.0.0.1:4010/v1/health/ready | |

Each staff account works only on its own login page. These are **demo credentials in a demo server, not real authentication.**

## What you can do
**Storefront (EN | বাংলা, Day | Night):** 59 real products in 3 categories; typo-tolerant search in English and Bangla; sorting and category filters; product pages; cart; **delivery zones** (In City = everything within 24 h; Outer City = all Bakery + approved Dairy Sweets/Doi, 1–2 days; ineligible cart lines are flagged, never silently removed); **ordering hours** 10:00–22:00 Asia/Dhaka (browsing always allowed); **three fulfilment modes** — Home Delivery (write your address), Express Pickup (≥ 1 hour ahead; confirmed only when the outlet marks it ready), Bulk Order (collection only at Modina Market Branch, simulated prepayment, no delivery); **My orders** (orders placed from this browser, auto-refreshing status); About page.
**Admin:** dashboard counts; products (quick price entry, sizes/prices/offers/stock, descriptions, photo upload, show/hide, Outer City switch); categories; orders (filter, detail, status steps, cancel); settings (ordering hours, bulk minimum, reset demo data). **Manager:** the same screens, read-only (the API refuses writes with 403).
Admin changes appear on the storefront at once. Data is kept in `demo/mock-api/runtime/store.json` and uploaded photos in `demo/mock-api/media/` (Settings → Reset demo data, or delete `runtime/`, to start over). Product/category **deletion is not offered**: products are hidden, categories are switched off.

## What is simulated / known limits
- No database, customer login, SMS, payment gateway or email. "Payment" is a labelled simulation; bulk prepayment is a button. Orders are saved in the mock API.
- The ordering-hours, pickup lead-time and zone checks run in the browser for UX; the mock API repeats zone and bulk checks but **not** the hours. None of this is a security guarantee.
- The bulk minimum (20 items / ৳20,000) is a **placeholder** until the owner approves values (Admin → Settings).
- 11 product names are marked "unverified" and kept out of Outer City (see `docs/CATALOGUE_V2_5_1.md`); English names are transliterations needing owner approval.
- No product photos are bundled (none could be downloaded); products show an intentional category tile until you upload a photo.
- Delivery slots, coupons, payments, stock counts, transfers and the rider app from the real backend design are not part of this demo.

## Commands (from the project folder)
```bash
pnpm typecheck                       # all workspaces
pnpm lint
pnpm --filter @dudhwala/shared test  # business rules, search, translations (vitest)
pnpm test:demo                       # mock API + catalogue tests (node:test; build shared first)
pnpm --filter @dudhwala/web build    # production build (needs NEXT_PUBLIC_API_URL, see docs/DEPLOYMENT_FRONTEND.md)
# browser tests (need a running demo and Chromium: `pnpm --filter @dudhwala/e2e exec playwright install chromium`):
pnpm install --filter @dudhwala/e2e...
pnpm test:demo:browser               # storefront, admin, platform (theme/a11y/responsive), resilience
```
Set `PW_CHROMIUM_PATH=/path/to/chromium` to use an installed browser.

## Production deployment (frontend only)
See `docs/DEPLOYMENT_FRONTEND.md` (environment variables, same-origin API proxy, checklist) and `docs/ADMIN_AND_API_CONTRACT.md` (the API the frontends expect). Leave `NEXT_PUBLIC_DEMO_BRANDING` unset in production. `docs/PHASE2_INTEGRATION.md` lists the demo parts to replace. `docs/AUDIT_V2_7.md` records the V2.7 audit.

## Design system
One token set and one component stylesheet shared by both apps: `packages/ui/styles/dw.css` (colours, radii, shadows, motion, buttons, forms, cards, tables, badges, notices, dialogs, light/dark themes). Theme and language switches live in `packages/ui/src`. Theme choice is stored as `dw.theme`, language as `dw.lang` (browser localStorage); with no stored choice the system colour scheme is used.

## Troubleshooting
- *Node 22+ required* — install a newer Node. *pnpm not found* — `corepack enable` or `npm install -g pnpm@9.15.9`.
- *Port in use* (3100, 3101, 4010) — stop the other program or a previous demo.
- *Error right after start* — wait ~10 s and refresh.
- *Start from scratch* — delete `node_modules`, `apps/*/.next` and `demo/mock-api/runtime`.
- Wrong password — use each login on its own page (admin vs manager).

## V2.7 change log
- **Design system:** shared tokens + solid rich colour-grade look with crisp pixel-style edges and details; one stylesheet for both apps (the two diverged CSS files, ~1,000 lines of stacked overrides, were consolidated).
- **Day/Night mode** for storefront and admin/manager: system preference on first visit, persisted, no flash, keyboard accessible, tuned night palette.
- **Customer screens completed:** demo "My orders" + order page (private order token), login page that explains the demo, loading/empty/error states, retry buttons, error boundaries, duplicate-submit protection.
- **Fixes:** hydration error in English mode (caused by a Suspense boundary), endless cart spinner when the API is down, header overflow on phones, zone-strip control sizing, unreadable hero text/contrast in night mode, link/contrast issues, missing form label (admin photo upload), unprefixed `h-px` class clash.
- **Admin:** stale-data warning when a refresh fails; shared status badges/notices.
- **Cleanup:** removed unused dependency (`qrcode`), dead helpers, unused CSS and a hot-linked demo image origin; duplicated language switch moved to `packages/ui`.
- **Tests:** browser suites (storefront 83 checks, admin 70, platform 54 incl. axe in both themes, resilience 8) are now part of the repository (`e2e/demo`); API tests extended (order tokens).
- Earlier versions: V2.5 real catalogue/zones/ordering, V2.5.1 bulk page, V2.6 rebuilt admin + manager login.
