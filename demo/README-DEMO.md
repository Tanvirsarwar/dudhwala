# Dudhwala – local client demo (V2.5: real catalogue, delivery zones, demo ordering)

A **temporary, offline-capable demo** of the Dudhwala storefront and admin on your own PC.
It uses the real Premium UI code with a small **mock API**.

> **Product names and the delivery-eligibility marks come from the shop's real printed lists. Prices, pack sizes and stock were not supplied, so they are empty ("Price to be announced").** Orders, outlets, the admin dashboard and the admin account are demo data and **not real**.
> No database, payment gateway, SMS or cloud service is used. Nothing is sent anywhere, no orders or money are taken.

## Requirements
- **Node.js 22 or newer** (https://nodejs.org)
- **pnpm 9.15.9** – installed automatically if you run `corepack enable` (ships with Node), or `npm install -g pnpm@9.15.9`
- Internet is needed **only on the first run** to download dependencies. Afterwards the demo runs offline.
- About 1.5 GB free disk space and a few minutes for the first build.

## Start
| System | Command |
|---|---|
| Linux / macOS | `./start-demo.sh` (run `chmod +x start-demo.sh` once if needed) |
| **NixOS** | `./start-demo-nixos.sh` (uses `nix-shell -p nodejs_22 pnpm steam-run`; see the NixOS note below) |
| Windows | double-click `start-demo.bat` (or run it in Command Prompt) |

First run installs dependencies and builds the two sites (a few minutes). Later runs start in seconds.

## Addresses (127.0.0.1 only – not reachable from other computers)
| What | URL |
|---|---|
| Storefront | http://127.0.0.1:3100 |
| Admin | http://127.0.0.1:3101 – login `admin@demo.local` / password `demo1234` |
| Mock API check | http://127.0.0.1:4010/v1/health/ready |

## V2.5: real catalogue, delivery zones and demo ordering
- **Real catalogue:** 59 products in 3 categories (Dairy Sweets 23, Doi / Dairy 11, Bakery 25) replace the old invented sample products. Details, unclear names and open questions: `docs/CATALOGUE_V2_5.md`. No price, size or stock was invented.
- **Delivery zone selector** (strip under the header). **In City**: every product, delivery within 24 hours (no instant delivery). **Outer City**: all Bakery plus only the ticked Dairy Sweets (Ghee, Nimki), delivery in 1-2 days; Doi and unconfirmed items are hidden. The cart is re-checked when you change zone: unsuitable items are **marked, never silently removed**, and block checkout until you switch zone or remove them.
- **Ordering hours:** 10:00-22:00 Asia/Dhaka (real clock of the computer, evaluated in the Dhaka time zone). Outside them the checkout is blocked with a bilingual message and the reopening time.
- **Checkout (demo):** three options. *Home Delivery* (zone, address, estimated delivery, "cash on delivery - demo"); *Express Pickup* (choose an outlet; earliest pickup is at least 1 hour away; pickup counts as confirmed only when the outlet marks it ready - use "Demo: move to next step" on the Demo orders page); *Bulk Order* (carts of 20+ items; collection only from Modina Market Branch; "Demo/Simulated Payment" first; no home or instant delivery). **The bulk threshold (20 items) is a placeholder** until the shop approves real values. The amount threshold cannot be checked yet because no prices exist.
- **Demo orders** are saved only in this browser (`localStorage`, keys `dw.demo.zone` and `dw.demo.orders`), have `DEMO-` numbers and are never real orders. There is no card form, payment gateway, SMS or login in this flow.
- The validation in the browser is for the demo only and is **not** security. Phase 2 notes: `docs/PHASE2_INTEGRATION.md`.
- Tests: `pnpm --filter @dudhwala/shared test` (ordering rules, search, translations) and `pnpm test:demo` (catalogue and eligibility, needs `pnpm --filter @dudhwala/shared build` first).

## V2.4: shopping experience
- **Full-width layout:** content now uses the whole screen up to 2000 px (8 cards per row on a 1920 px desktop) with balanced side padding.
- **Fuzzy search:** the header box and the Search page give live suggestions (image, name, sample price) and tolerate typos and transliterations: `mlk`, `dudh` → Milk; `ghi`, `gee` → Ghee; `doi`, `dohi` → Doi; `biscute`, `biskut` → Biscuit; `sandsh`, `shondesh` → Sandesh; `roshogolla` → Rasgulla; Bangla works too. Arrow keys, Enter, Esc and touch work; no-match shows "Did you mean". Spellings live in one editable list (`SEARCH_ALIASES` in `packages/shared/src/search.ts`).
- **Categories:** the bar above the product grid filters the grid (counts, active state, clear filters) and works together with search and sorting.
- **Product pages:** "You May Also Like" (same category, then complementary categories) and "Recently Viewed" (kept in this browser).

## V2.3: scroll stability and compact cards
Cards could blank out while scrolling on real GPUs because the page stacked too many compositor-heavy layers (measured on V2.2: 39 blurred surfaces, 51 transformed elements, 21 3D contexts, 26 finished animations still applied, and a fixed background repainted every frame). V2.3 keeps blur only on the header, panels and dialogs, applies the 3D tilt only while a card is hovered, stops entrance animations from lingering after they finish, and paints the background on one fixed layer. Product cards, dashboard tiles and About cards are also smaller (5 product cards per row on a 1280 px desktop instead of 4). If you still see a card flicker on your machine, tell me the browser and GPU.

## About page and developer credit (V2.2)
Footer → "দুধওয়ালা সম্পর্কে" / "About Dudhwala" opens an editorial About page. Its story is limited to what a 2021 report in The Business Standard states (a Sylhet dairy venture begun by four dairy farmers, starting with raw milk and growing into dairy products and traditional sweets). It is historical background, not a statement about current operations; the page says so. Product pictures are the demo's own generated artwork. The footer and the end of the About page carry a plain (non-clickable) "Designed & Developed by PETRA Software Solutions" credit with the supplied PETRA logo, unmodified.

## Delivery area picker
Header → "Choose area" opens a card picker. Pick one card, then press **Confirm delivery area** (ডেলিভারি এলাকা নিশ্চিত করুন): the choice is saved to the cart and the page refreshes with area-specific availability. The demo data has area names only (no delivery fees or service status), so none are shown.

## Language: EN | বাংলা
The `EN | বাংলা` switch is in the storefront header and the admin top bar (and on the admin login page). The choice is remembered in the browser and survives refresh and navigation. English uses Montserrat; Bangla uses Hind Siliguri with Noto Sans Bengali as fallback. The storefront (home, categories, search, product pages, cart, area picker, sign-in) and the main admin screens (menu, dashboard, orders list, products, stock, branches) are translated. Rarely used admin screens (delivery rules, coupons, payments, reports, staff forms, long help texts) remain in Bangla.

## NixOS note
NixOS cannot run the prebuilt native binaries in `node_modules` directly. `start-demo-nixos.sh` wraps the normal script in `steam-run`. If that does not work on your machine, enable `programs.nix-ld.enable = true;` in `configuration.nix` (then rebuild) and run `./start-demo.sh` inside `nix-shell -p nodejs_22 pnpm`. **This NixOS path was not tested** (no NixOS machine was available when this package was made).

## What works
- Storefront: home with hero and collection, categories, product listing, **search** (Bangla or English), sorting, product pages, **add to cart**, cart quantities, delivery-zone selector, demo checkout, demo orders, delivery-area picker, information pages.
- Admin (view only): dashboard summary, order list with status filter and search, product list and product pages, inventory per branch, branch list.
- Product pictures are simple generated illustrations marked "DEMO ARTWORK" (no real photos are included).

## Intentionally simulated or not available
- **Customer login does not work** and there is no SMS or real payment. The V2.5 demo checkout works without login and only saves a demo order in your browser.
- **Admin changes are not saved** (editing, publishing, uploads, price import show a "demo mode" message). Order detail pages, reports, delivery and coupon screens are empty or unavailable.
- The cart lives in the mock server's memory and **resets when the demo is restarted**; demo orders and the zone choice stay in your browser until you clear them.
- The numbers on the admin dashboard are computed from the invented sample orders.

## Stop
- Linux/macOS: press **Ctrl+C** in the terminal.
- Windows: close the three "Dudhwala demo" windows, or run `stop-demo.bat`.

## Troubleshooting
- *"Node.js 22+ required"* – install a newer Node.js and open a new terminal.
- *pnpm not found* – run `corepack enable` (may need an administrator terminal on Windows) or `npm install -g pnpm@9.15.9`.
- *Port already in use* (3100, 3101 or 4010) – close the other program, or stop a previous demo.
- *Page shows an error right after start* – wait ~10 seconds and refresh; the sites need a moment to start.
- *Start over from scratch* – delete the `node_modules` folder and the `apps/web/.next` and `apps/admin/.next` folders, then start again.
- Admin login says wrong password – use exactly `admin@demo.local` and `demo1234`.

## What is inside
`apps/web` (storefront) and `apps/admin` (admin) are the project's real Next.js apps, unchanged; `packages/shared` is their shared code; `demo/mock-api` is the mock server (`server.mjs`, sample data in `data.mjs`, no dependencies). The sites are built so their `/v1/*` requests are forwarded to the mock API.
