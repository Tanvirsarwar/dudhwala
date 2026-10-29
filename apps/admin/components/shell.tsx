'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { ROLE_BN } from '@/lib/format';
import { LangToggle } from '@dudhwala/ui/lang';
import { ThemeToggle } from '@dudhwala/ui/theme';

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
}
const NAV: NavItem[] = [
  { href: '/', label: 'ড্যাশবোর্ড' },
  { href: '/orders', label: 'অর্ডার' },
  { href: '/products', label: 'পণ্য' },
  { href: '/categories', label: 'ক্যাটাগরি' },
  { href: '/settings', label: 'সেটিংস', adminOnly: true },
];
const STOREFRONT = process.env.NEXT_PUBLIC_STOREFRONT_URL;

export function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const items = NAV.filter((i) => !i.adminOnly || s.canEdit);

  return (
    <div className="admin min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">
        মূল অংশে যান
      </a>
      <aside className={`${open ? 'block' : 'hidden'} glass-side border-r border-line md:block`}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <img src="/logo.png" alt="দুধওয়ালা" width={36} height={36} className="h-9 w-9 rounded" />
          <div className="leading-tight">
            <p className="font-bold text-brand-700">দুধওয়ালা</p>
            <p className="text-xs text-muted">{s.isManager ? 'ম্যানেজার প্যানেল' : 'অ্যাডমিন প্যানেল'}</p>
          </div>
        </div>
        <nav aria-label="প্রধান মেনু" className="p-2">
          <ul className="grid gap-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} onClick={() => setOpen(false)} aria-current={active(i.href) ? 'page' : undefined} className={`block rounded-xl px-3 py-2.5 ${active(i.href) ? 'bg-brand-600 font-semibold text-on-brand' : 'text-ink hover:bg-brand-100'}`}>
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
          {STOREFRONT && (
            <a href={STOREFRONT} target="_blank" rel="noreferrer" className="mt-3 block rounded-xl px-3 py-2.5 text-sm text-link underline">
              দোকান দেখুন ↗
            </a>
          )}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 glass-bar border-b border-line px-4 py-2">
          <button type="button" className="btn btn-ghost btn-sm md:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            মেনু
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <LangToggle />
            <ThemeToggle />
            <span className="hidden text-muted sm:inline">
              {s.me.user.fullName} · {ROLE_BN[s.me.role]}
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void s.logout()}>
              লগআউট
            </button>
          </div>
        </header>
        {s.isManager && (
          <p role="note" className="bg-warn-bg px-4 py-1.5 text-center text-sm font-semibold text-ink">
            ম্যানেজার (শুধু দেখা): আপনি অর্ডার ও পণ্যের তথ্য দেখতে পারবেন, কিছু পরিবর্তন করতে পারবেন না।
          </p>
        )}
        <main id="main" className="mx-auto max-w-[1400px] p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
