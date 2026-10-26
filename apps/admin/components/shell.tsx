'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Permission } from '@dudhwala/shared';
import { useSession } from '@/lib/session';
import { ROLE } from '@/lib/format';

interface NavItem {
  href: string;
  label: string;
  perm?: Permission;
  superOnly?: boolean;
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'দৈনিক কাজ',
    items: [
      { href: '/', label: 'ড্যাশবোর্ড', perm: 'orders.read' },
      { href: '/orders', label: 'অর্ডার', perm: 'orders.read' },
      { href: '/picklist', label: 'পিক লিস্ট', perm: 'orders.prepare' },
      { href: '/inventory', label: 'স্টক', perm: 'inventory.read' },
      { href: '/stock-counts', label: 'স্টক গণনা', perm: 'inventory.count' },
      { href: '/transfers', label: 'স্টক ট্রান্সফার', perm: 'inventory.read' },
      { href: '/cod', label: 'ক্যাশ (COD) জমা', perm: 'cod.confirm_handover' },
    ],
  },
  {
    group: 'ব্যবস্থাপনা',
    items: [
      { href: '/catalog', label: 'পণ্য ও দাম', perm: 'catalog.read_admin' },
      { href: '/delivery', label: 'ডেলিভারি ও স্লট', perm: 'outlets.read' },
      { href: '/outlets', label: 'আউটলেট ও স্টাফ', perm: 'outlets.read' },
      { href: '/hours', label: 'খোলার সময় ও ছুটি', perm: 'outlets.read' },
      { href: '/content', label: 'ব্যানার ও পেজ', perm: 'content.manage' },
      { href: '/coupons', label: 'কুপন', perm: 'coupons.manage' },
    ],
  },
  {
    group: 'হিসাব',
    items: [
      { href: '/payments', label: 'পেমেন্ট ও রিফান্ড', perm: 'payments.reconcile' },
      { href: '/reports', label: 'রিপোর্ট', perm: 'reports.outlet' },
      { href: '/audit', label: 'অডিট লগ', perm: 'audit.read' },
      { href: '/privacy', label: 'গ্রাহক তথ্য মুছা', perm: 'customers.privacy' },
      { href: '/settings', label: 'সেটিংস', perm: 'settings.outlet' },
    ],
  },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const outlet = s.outlets.find((o) => o.id === s.outletId);

  return (
    <div className="admin min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        মূল অংশে যান
      </a>
      <aside className={`${open ? 'block' : 'hidden'} border-r border-line bg-white md:block`}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <img src="/logo.png" alt="দুধওয়ালা" width={36} height={36} className="h-9 w-9 rounded" />
          <div className="leading-tight">
            <p className="font-bold text-brand-700">দুধওয়ালা</p>
            <p className="text-xs text-muted">অ্যাডমিন</p>
          </div>
        </div>
        <nav aria-label="প্রধান মেনু" className="p-2">
          {NAV.map((g) => {
            const items = g.items.filter((i) => (!i.perm || s.can(i.perm)) && (!i.superOnly || s.isSuper));
            if (!items.length) return null;
            return (
              <div key={g.group} className="mb-3">
                <p className="px-2 py-1 text-xs font-semibold uppercase text-muted">{g.group}</p>
                <ul>
                  {items.map((i) => (
                    <li key={i.href}>
                      <Link
                        href={i.href}
                        onClick={() => setOpen(false)}
                        aria-current={active(i.href) ? 'page' : undefined}
                        className={`block rounded-lg px-3 py-2 text-sm ${active(i.href) ? 'bg-brand-600 font-semibold text-white' : 'text-ink hover:bg-brand-100'}`}
                      >
                        {i.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2">
          <button type="button" className="btn btn-ghost btn-sm md:hidden" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            মেনু
          </button>
          {s.isSuper ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted">আউটলেট</span>
              <select className="field field-sm w-auto" value={s.outletId ?? ''} onChange={(e) => s.setOutletId(e.target.value || null)}>
                <option value="">সব আউটলেট</option>
                {s.outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.nameBn}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="badge border-[#cfd1ee] bg-brand-100 text-brand-700" aria-label="সক্রিয় আউটলেট">
              {outlet ? `${outlet.code} — ${outlet.nameBn}` : 'আউটলেট'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">
              {s.me.user.fullName ?? s.me.user.email} · {ROLE[s.me.role]}
            </span>
            <Link href="/password" className="btn btn-ghost btn-sm">
              পাসওয়ার্ড
            </Link>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void s.logout()}>
              লগআউট
            </button>
          </div>
        </header>
        <main id="main" className="p-4">
          {children}
        </main>
      </div>
    </div>
  );
}
