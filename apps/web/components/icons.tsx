/** Minimal outline icons (1.75 px stroke, UI_UX_SPEC §5). Decorative: aria-hidden. */
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const CartIcon = () => (
  <svg {...base}>
    <circle cx="9" cy="20" r="1.4" />
    <circle cx="18" cy="20" r="1.4" />
    <path d="M2.5 3.5h2.6l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2l1.4-7.2H6.1" />
  </svg>
);
export const SearchIcon = () => (
  <svg {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
export const UserIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </svg>
);
export const PinIcon = () => (
  <svg {...base} width={18} height={18}>
    <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </svg>
);
export const BottleIcon = () => (
  <svg {...base} width={48} height={48}>
    <path d="M9 2.5h6v3l2 3V20a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 20V8.5l2-3z" />
    <path d="M7 12h10" />
  </svg>
);

const big = { ...base, width: 64, height: 64, strokeWidth: 1.4 };
/** Category line icons for products without a photo (decorative). */
export const SweetIcon = () => (
  <svg {...big}>
    <circle cx="8.5" cy="15" r="4.2" />
    <circle cx="15.5" cy="15" r="4.2" />
    <circle cx="12" cy="8.6" r="4.2" />
    <path d="M10.6 7.2c.5-.5 1.1-.8 1.8-.8" />
  </svg>
);
export const CupIcon = () => (
  <svg {...big}>
    <path d="M5 9h14l-1.6 10.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8z" />
    <path d="M4 9h16M8 5.5h8" />
    <path d="M9 13.5q3 2 6 0" />
  </svg>
);
export const BreadIcon = () => (
  <svg {...big}>
    <path d="M5 10.5a3.5 3.5 0 0 1 2-6.3h10a3.5 3.5 0 0 1 2 6.3V18a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    <path d="M9 11v5M12 11v5M15 11v5" />
  </svg>
);
