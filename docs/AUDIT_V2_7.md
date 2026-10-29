# V2.7 frontend audit (storefront, admin/manager, shared code)

Baseline (V2.6, before any change): `pnpm typecheck` clean; `pnpm lint` clean; shared tests 123 pass; `pnpm test:demo` 19 pass; production build of both apps via `start-demo.sh` OK; browser suites (ad-hoc scripts) 60/60 admin and 96/96 storefront. Everything below was found by reading the code and by new browser tests, not by the baseline.

## Findings and what was done
| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Two diverged stylesheets (storefront 919 lines, admin ~430) with V1/V2/V2.3 override layers, 140+ hard-coded colours, duplicated `lang.tsx`; no theme support | high | `packages/ui/styles/dw.css` (tokens, light/dark, shared components) + small app files; `packages/ui` hosts the theme and language switches |
| 2 | No Day/Night mode | requirement | implemented for both apps (see README) |
| 3 | English mode threw React hydration error #418 on most pages once a root `loading.tsx` existed (language runtime rewrites text before the suspended page hydrates) | high | root `loading.tsx` removed from both apps; documented in `packages/ui/src/lang.tsx` neighbours; browser test fails on any page error |
| 4 | Soft 404s (HTTP 200 for unknown product/info page) caused by the same Suspense boundary | medium | fixed by the same removal; test asserts 404 |
| 5 | Cart page showed a spinner forever when the API was unreachable; checkout error had no retry | high | error panel with "try again" on cart and checkout; skeleton loaders |
| 6 | Customer `/account`, `/login`, `/orders/[id]` were non-functional in the demo (needed OTP backend) | high | demo "My orders" (order id + private token kept in this browser), order page with auto-refresh, explanatory login page; production code paths untouched |
| 7 | Orders placed in the storefront had no customer-side view; token never existed | medium | server returns a private token once; `GET /orders/:id` needs it; staff views never contain it; tested |
| 8 | Header overflowed on 360–412 px phones (+100 px) | high | switches moved to their own row on phones |
| 9 | Zone-strip buttons used removed class names (20 px tall, unstyled) | medium | moved to shared `.seg` classes; 36 px+ |
| 10 | Night mode: hero paragraph unreadable (theme-dependent token on an always-dark bar), `hover:text-accent-100` on dark bars, brand-600 links low contrast | high | `--dw-bar-ink`, `--dw-link` tokens |
| 11 | `.pill b` count text contrast 4.1–4.3 (axe) | low | fixed |
| 12 | Admin photo `<input type=file>` had no label (axe critical) | medium | `aria-label` |
| 13 | A custom `.h-px` class collided with Tailwind's `h-px` (height 1px) | low | renamed `.h-dots` |
| 14 | Admin: refresh failures left old numbers on screen with no warning | medium | `StaleNotice` on dashboard/orders/products |
| 15 | No route/global error boundaries | medium | `error.tsx` + `global-error.tsx` in both apps |
| 16 | Dead code: admin `qrcode` dependency, `download()`, `todayDhaka`, `PhoneIcon`, `.btn-tertiary`, `.dotted`, `.rule-dots`, hot-linked dev image origin (`wellfoodonline.com`) in both `next.config.ts` | low | removed |
| 17 | Order, pickup and bulk orders needed a contact name/phone (admin could not call the customer) | medium | done in V2.6; covered by tests |

## Checked and found fine
No `any`/`@ts-ignore` in the apps; no `127.0.0.1` or secrets in client code (`localhost` appears only as the dev default in `lib/api.ts` and `next.config.ts`, which refuses to build for production without `NEXT_PUBLIC_API_URL`); CSP present in both apps; all interactive demo controls have outcomes (exercised by the browser suites).

## Deliberately deferred (backend-dependent)
Customer OTP login and saved addresses, real payments, SMS, server-side ordering-hours/pickup enforcement, real staff authentication/MFA/audit, delivery slots/coupons/stock counts/transfers/rider app, product/category deletion, image storage/resizing. See `docs/DEPLOYMENT_FRONTEND.md`, `docs/PHASE2_INTEGRATION.md`, `docs/ADMIN_AND_API_CONTRACT.md`.

## Not verified here
Windows launcher and NixOS launcher were not executed (no Windows/Nix in the build environment). Real GPU scroll behaviour (headless software rendering only). Real screen readers (axe automated rules only).
