# Dudhwala – local client demo (V2: glass UI + EN | বাংলা)

A **temporary, offline-capable demo** of the Dudhwala storefront and admin on your own PC.
It uses the real Premium UI code with a small **mock API** that serves **invented sample data**.

> Everything you see is demo data: product names, prices, stock, orders and the admin account are **not real**.
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

## Language: EN | বাংলা
The `EN | বাংলা` switch is in the storefront header and the admin top bar (and on the admin login page). The choice is remembered in the browser and survives refresh and navigation. English uses Montserrat; Bangla uses Hind Siliguri with Noto Sans Bengali as fallback. The storefront (home, categories, search, product pages, cart, area picker, sign-in) and the main admin screens (menu, dashboard, orders list, products, stock, branches) are translated. Rarely used admin screens (delivery rules, coupons, payments, reports, staff forms, long help texts) remain in Bangla.

## NixOS note
NixOS cannot run the prebuilt native binaries in `node_modules` directly. `start-demo-nixos.sh` wraps the normal script in `steam-run`. If that does not work on your machine, enable `programs.nix-ld.enable = true;` in `configuration.nix` (then rebuild) and run `./start-demo.sh` inside `nix-shell -p nodejs_22 pnpm`. **This NixOS path was not tested** (no NixOS machine was available when this package was made).

## What works
- Storefront: home with hero and collection, categories, product listing, **search** (Bangla or English), sorting, product pages with pack sizes, **add to cart**, cart quantities, delivery-area picker, information pages, out-of-stock items, offer badges.
- Admin (view only): dashboard summary, order list with status filter and search, product list and product pages, inventory per branch, branch list.
- Product pictures are simple generated illustrations marked "DEMO ARTWORK" (no real photos are included).

## Intentionally simulated or not available
- **Customer login and checkout do not work**: they show "demo mode". There is no SMS or payment in this package.
- **Admin changes are not saved** (editing, publishing, uploads, price import show a "demo mode" message). Order detail pages, reports, delivery and coupon screens are empty or unavailable.
- The cart lives in memory and **resets when the demo is restarted**.
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
