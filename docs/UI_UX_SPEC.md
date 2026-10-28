> **Superseded in part (Phase 2).** This document describes the original delivery-slot / area / COD / rider design, which the Phase 2 backend replaced. Current documents: [PHASE2_BACKEND](PHASE2_BACKEND.md), [ADMIN_AND_API_CONTRACT](ADMIN_AND_API_CONTRACT.md), [DEPLOY_PHASE2](DEPLOY_PHASE2.md). Where they disagree, Phase 2 wins.

# UI / UX Specification

Status: Draft v0.1 — 2026-10-19
Source of truth for brand: `assets/reference/opening-invitation.png` (Dudhwala showroom opening invitation, supplied by the business).

## 1. Brand analysis of the reference image

What the image contains:

- **Logo lockup** (bottom centre): a milk-bottle illustration with two drops spraying from the cap, the Bangla wordmark **দুধওয়ালা** in a custom hand-drawn style inside a rounded frame that ends in a cow-udder flourish, a small "Serving Purity" script tagline under the frame, a "TM" mark, and the line **DUDHWALA FOOD PRODUCTS** in a condensed bold sans-serif below.
- **Field colour**: a flat, saturated royal blue with a slight violet lean covers the whole background.
- **Accent colour**: a bright cyan is used for the hand-lettered Bangla display titles ("শুভ উদ্বোধন", "অনুষ্ঠান সূচী"), highlighted words, the left-hand timeline rule and its end dot.
- **Milk-white**: a photographic milk splash fills the lower third. The white is slightly cool and has soft grey shading.
- **Body text** is white Bangla in a traditional Bangla text face, justified.
- Personality: celebratory but clean; familiar Bangladeshi visual language (hand-lettered Bangla, formal salutation); emphasis on purity and freshness.

What it does **not** contain: a transparent logo file, product photos, an English body typeface specimen, or any web UI. See OPEN_DECISIONS A1–A4, A8.

## 2. Sampled colours

Sampled programmatically from the reference PNG (1440 × 1030) using exact pixel counts in flat regions. Values are the modal colour of each region.

| Role | Sampled hex | Where sampled | Pixel evidence |
|------|-------------|---------------|----------------|
| Brand royal blue (primary) | `#2D308F` | Flat background, top right | 35,000 / 35,000 px identical |
| Wordmark navy | `#23315E` | Darkest strokes of the logo wordmark | modal dark stroke colour |
| Logo tagline blue | `#322F7E` | "DUDHWALA FOOD PRODUCTS" strokes | anti-aliased, close to primary |
| Cyan accent | `#05B2EE` | "শুভ উদ্বোধন" lettering | modal; neighbours `#04B2EE`, `#03B3EE` |
| Bottle sky blue | `#79B9E5` | Milk-bottle illustration fill | 1,125 px modal |
| Milk white | `#F8F8F8` | Milk splash highlight | most common light tone |
| Milk shadow | `#E8E8E8` | Milk splash shading | most common mid tone |

The background blue measured `#2C308C` under 4-step quantisation and `#2D308F` exactly; use `#2D308F`.

### 2.1 Contrast results (WCAG 2.x)

| Foreground | Background | Ratio | Use |
|-----------|------------|-------|-----|
| `#2D308F` | `#FFFFFF` | 10.88 : 1 | Body text, headings, buttons — AAA |
| `#FFFFFF` | `#2D308F` | 10.88 : 1 | Text on primary — AAA |
| `#2D308F` | `#F8F8F8` | 10.24 : 1 | Text on milk surface — AAA |
| `#05B2EE` | `#FFFFFF` | **2.44 : 1** | **Fails for text.** Decorative only on white. |
| `#05B2EE` | `#2D308F` | 4.46 : 1 | Large text (≥ 24 px, or ≥ 18.66 px bold) and icons only on primary. |
| `#0277A8` | `#FFFFFF` | 4.99 : 1 | Derived "cyan ink" for links/accents as text on white — AA |
| `#79B9E5` | `#2D308F` | 5.12 : 1 | Secondary text/icons on primary — AA |
| `#23315E` | `#05B2EE` | 5.15 : 1 | Navy text on cyan badges (e.g. cart count) — AA |
| `#FFFFFF` | `#3A3EA6` | 8.68 : 1 | Button text on hover state — AAA |

Derived status colours on white: success `#1E7A46` 5.35, warning `#8A5A00` 5.93, danger `#B42318` 6.57 — all AA.

Consequence: the cyan accent stays exactly the sampled colour for fills, rules, badges with dark text, illustrations and large display text on the blue field. Whenever cyan must carry **small text on white**, use the derived `cyan-ink #0277A8`, which keeps the hue and passes AA. This is a documented accessibility adaptation, not a palette change.

## 3. Design tokens

Implemented once in `packages/ui/tokens.css` (CSS custom properties) and mirrored in the Tailwind theme. All components consume tokens; no raw hex values in component code.

```css
:root {
  /* Brand — sampled */
  --color-brand-700: #23315E;   /* wordmark navy: pressed states, footer */
  --color-brand-600: #2D308F;   /* PRIMARY royal blue */
  --color-brand-500: #3A3EA6;   /* hover (primary +8% lightness) */
  --color-brand-100: #E7E8F6;   /* tinted surface, selected rows */
  --color-accent-500: #05B2EE;  /* ACCENT cyan — fills, rules, badges */
  --color-accent-ink: #0277A8;  /* cyan as small text on white (AA) */
  --color-accent-100: #E1F5FD;  /* accent tint surface */
  --color-sky-300:   #79B9E5;   /* bottle blue — illustrations, secondary on primary */

  /* Surfaces — sampled */
  --color-surface:      #FFFFFF;
  --color-surface-milk: #F8F8F8;
  --color-border:       #E8E8E8;

  /* Text */
  --color-text:        #1B1D4A;  /* near-navy body text, 15.89:1 on white */
  --color-text-muted:  #555874;  /* 6.92:1 on white, 6.52:1 on milk — AA */
  --color-text-on-brand: #FFFFFF;

  /* Status (functional, not brand) */
  --color-success: #1E7A46;
  --color-warning: #8A5A00;
  --color-danger:  #B42318;
  --color-info:    var(--color-accent-ink);

  /* Type */
  --font-bn: "Hind Siliguri", "Noto Sans Bengali", system-ui, sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
  --font-display-en: "Oswald", "Inter", sans-serif; /* echoes the condensed logo line; headings only */

  /* Scale (mobile first, rem at 16px) */
  --text-xs: .8125rem; --text-sm: .9375rem; --text-base: 1rem;
  --text-lg: 1.125rem; --text-xl: 1.375rem; --text-2xl: 1.75rem; --text-3xl: 2.25rem;
  --leading-bn: 1.7;   /* Bangla conjuncts and matras need extra line height */
  --leading-en: 1.5;

  /* Shape and space */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px; --radius-pill: 999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --shadow-card: 0 1px 2px rgba(35,49,94,.08), 0 2px 8px rgba(35,49,94,.06);
  --focus-ring: 0 0 0 3px var(--color-accent-500);
}
```

Derived values (`brand-500`, `brand-100`, `accent-100`, `accent-ink`, text and status colours) are calculated from sampled hues and documented here; they are not guesses of the brand palette.

Dark mode: not in v1 scope for the storefront (brand identity is white-surface dominant). Admin may add it later.

## 4. Typography

- **Bangla**: Hind Siliguri (OFL), weights 400/500/600/700, `lang="bn"` on `<html>`. Fallback Noto Sans Bengali. Both render conjuncts (যুক্তাক্ষর) and reph correctly. Line height 1.7.
- **Latin**: Inter (OFL) for UI text; Oswald (OFL) only for short English display labels, echoing the condensed "DUDHWALA FOOD PRODUCTS" line.
- **Numerals**: prices use Bangla numerals (০–৯) in Bangla locale via `Intl.NumberFormat('bn-BD')`; admin uses Latin numerals for data entry speed. Currency rendered as `৳` prefix.
- Fonts self-hosted through `next/font` (no runtime Google request), subset to Bengali + Latin.
- The hand-lettered Bangla display style and the custom wordmark are not imitated. If the business supplies licensed display fonts or lettering artwork, they replace headings in hero banners only.

## 5. Visual language

- Primary surfaces white; milk-white `#F8F8F8` for page background bands; royal blue for header, footer, primary buttons and hero bands.
- Cyan used sparingly: active tab underline, price-drop or "in stock" badge fill, focus ring, small dividers — echoing the invitation's cyan rule-and-dot motif.
- A single optional decorative element: a soft milk-wave SVG divider (flat, `#F8F8F8` on `#2D308F`) at the bottom of the hero and above the footer. No gradients, no glassmorphism, no floating blobs.
- Iconography: one outline icon set (Lucide), 1.75 px stroke, 20/24 px sizes.
- Motion: 150–200 ms opacity/transform transitions only; all disabled under `prefers-reduced-motion`.
- Imagery: real product photos on white or milk-white, 1:1 crops, consistent lighting. Missing photo → flat brand-100 tile with a bottle outline icon and "ছবি শীঘ্রই আসছে" (photo coming soon). Never stock or generated images.

## 6. Components (storefront)

| Component | Notes |
|-----------|-------|
| Header | Royal blue bar; logo slot (left); search (expands full width on mobile); account; cart button with item count badge (cyan fill, navy text). Sticky on scroll, 56 px mobile / 72 px desktop. |
| Area banner | Thin bar under header: "ডেলিভারি এলাকা: [area] · পরিবর্তন" — lets customer set area first so availability is accurate. |
| Category chips | Horizontal scroll on mobile, wrap on desktop. Selected chip brand-600 fill. |
| Product card | Photo, Bangla name, pack size, price (bold, brand-700), stock state, add button. Add button becomes a −/qty/+ stepper after adding. Out-of-stock: greyed photo, "স্টকে নেই" label, button disabled with explanation on tap. |
| Variant selector | Segmented buttons for pack sizes; unavailable variants disabled with strike and reason. |
| Price | Always `৳` + amount; discounts show original price struck through only when a configured promotion applies. |
| Cart drawer | Slides from right (desktop) / bottom sheet (mobile); line items, stepper, remove, subtotal, delivery-fee note "চেকআউটে হিসাব হবে" until area known. |
| Checkout stepper | 1 ঠিকানা (address) → 2 সময় (slot) → 3 পেমেন্ট (payment) → 4 নিশ্চিত (review). Single page with collapsible sections on mobile. |
| Slot picker | Day tabs + slot list; full slots shown disabled with "পূর্ণ" (full); never hidden silently. |
| Order status timeline | Vertical; uses cyan rule + dot motif from the invitation for completed steps. |
| Toast / inline error | Inline errors next to fields with `aria-describedby`; toasts only for non-critical confirmations. |
| Footer | Navy `#23315E`; address, phone, policies, payment-method logos only for approved methods. |

## 7. Page layouts (storefront)

1. **Home**: header → area banner → approved hero banner(s) (admin-managed; hidden if none) → category grid → featured collection(s) → "popular" (only when ≥ N real orders exist; N configurable) → delivery-area info → about snippet → FAQ accordion → footer.
2. **Category / search**: filters (category, availability, price range) in a bottom sheet on mobile, sidebar on desktop; sort (relevance, price ↑↓, newest); 2-column grid mobile, 4-column desktop; paginated with "আরও দেখুন" load-more.
3. **Product detail**: gallery (swipe), name, variants, price, availability for selected area, qty, add to cart, delivery-area checker, then description, ingredients/allergens/storage/shelf-life sections rendered only when present.
4. **Cart**: full page version of drawer with coupon field.
5. **Checkout**: see §6; summary card sticky on desktop, collapsible "মোট ৳…" bar pinned to bottom on mobile.
6. **Payment return**: neutral "পেমেন্ট যাচাই করা হচ্ছে…" (verifying payment) state that polls the server; never shows success from URL parameters.
7. **Order confirmation / tracking**: order number, timeline, slot, items, payment status shown separately from order status.
8. **Account**: profile, addresses, orders, reorder, privacy (download my data request, delete account request).
9. **Static**: about, FAQ, policies, contact.

## 8. Admin and delivery UI

- Separate app, same tokens, denser scale (`--text-sm` base). Left sidebar (collapsible) + top bar showing the **active outlet** as a coloured pill at all times; outlet switcher shown only to Super Admin ("All outlets" or one outlet); outlet staff are fixed to their single outlet.
- Tables: sticky header, zebra off, row hover brand-100, status badges with text + icon (never colour alone), server-side pagination/sort/filter, date-range picker, CSV export button visible only with export permission.
- Order board: list view + kanban by status for outlet staff; large tap targets.
- Destructive actions: confirm dialog stating consequence; inventory write-offs require reason text.
- Delivery staff view: mobile-only layout, list of today's assigned deliveries ordered by slot, big "Call customer" and "Open in maps" buttons, status buttons sized ≥ 48 px, offline-tolerant (retries queued status updates when connectivity returns, idempotency keys prevent duplicates).
- Empty states explain the next action ("No slots configured — add delivery slots in Settings → Delivery").

## 9. Responsive rules

Breakpoints: `sm 480`, `md 768`, `lg 1024`, `xl 1280`. Design at 360 px first. Minimum tap target 44 × 44 px. No horizontal page scroll at any width ≥ 320 px. Admin tables collapse to card lists below `md`.

## 10. Accessibility checklist

- Semantic landmarks (`header`, `nav`, `main`, `footer`), one `h1` per page.
- All inputs have visible `<label>`; errors linked via `aria-describedby`; `aria-live="polite"` for cart count and payment-verification state.
- Focus visible on every interactive element (`--focus-ring`), logical tab order, dialogs trap focus and restore it on close (Radix primitives).
- Alt text from product data (Bangla); decorative images `alt=""`.
- Contrast per §2.1; automated axe checks in CI; manual screen-reader pass (TalkBack on Android Chrome — the dominant device class in Bangladesh) before launch.
- `prefers-reduced-motion` honoured.
- Phone inputs accept Bangla and Latin digits and normalise to `+8801XXXXXXXXX`.

## 11. Content rules

- No invented offers, reviews, testimonials, ratings, certifications, nutrition or health claims.
- Copy defaults to Bangla, plain and polite (আপনি form), matching the invitation's register.
