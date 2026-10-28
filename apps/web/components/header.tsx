import Link from 'next/link';
import { SearchIcon, UserIcon } from './icons';
import { SearchBox } from './search-box';
import { CartButton } from './header-client';
import { LangToggle } from '@dudhwala/ui/lang';
import { ThemeToggle } from '@dudhwala/ui/theme';
import { ZoneBar } from './zone-bar';

/** Royal-blue header with the supplied logo lockup (shown unmodified on its own white chip). */
export function Header() {
  return (
    <header className="sticky top-0 z-30 glass-nav text-on-brand">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-brand-700">
        মূল বিষয়ে যান
      </a>
      <div className="page-w flex items-center gap-3 py-2 md:py-3">
        <Link href="/" className="shrink-0 rounded-lg bg-white p-1" aria-label="দুধওয়ালা — প্রথম পাতা">
          <img src="/logo.png" alt="দুধওয়ালা — Dudhwala Food Products" width={96} height={51} className="h-10 w-auto md:h-12" />
        </Link>
        <SearchBox className="hidden flex-1 md:block" inputClass="h-11 w-full rounded-full border-0 bg-surface px-5 pr-12 text-ink placeholder:text-muted" />
        <nav className="ml-auto flex items-center gap-1" aria-label="অ্যাকাউন্ট ও কার্ট">
          <div className="hidden items-center gap-2 md:flex">
            <LangToggle onBar />
            <ThemeToggle onBar />
          </div>
          <Link href="/search" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-brand-500 md:hidden" aria-label="খুঁজুন">
            <SearchIcon />
          </Link>
          <Link href="/account" className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-brand-500" aria-label="আমার অ্যাকাউন্ট">
            <UserIcon />
          </Link>
          <CartButton />
        </nav>
      </div>
      {/* phones: the two switches get their own thin row so the icon row never overflows */}
      <div className="page-w flex justify-end gap-2 pb-2 md:hidden">
        <LangToggle onBar />
        <ThemeToggle onBar />
      </div>
      <ZoneBar />
    </header>
  );
}
