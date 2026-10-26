'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { ORDER_STATUS, taka } from '@/lib/format';
import { Loading, PageTitle } from '@/components/ui';

interface Dashboard {
  date: string;
  openByStatus: Record<string, number>;
  todayOrders: number;
  todayRevenuePoisha: number;
  lowStockItems: number;
  lateOrders: number;
}

const OPEN = ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'];

export default function DashboardPage() {
  const s = useSession();
  const { data, error } = useLoad<Dashboard>('/admin/dashboard');
  const scope = s.isSuper ? 'সব আউটলেট (একত্রে)' : s.outlets.find((o) => o.id === s.outletId)?.nameBn;

  return (
    <>
      <PageTitle title="ড্যাশবোর্ড">
        <span className="text-sm text-muted">{scope}</span>
      </PageTitle>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <section aria-label="আজকের সারাংশ" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="আজকের অর্ডার" value={String(data.todayOrders)} />
            <Stat label="আজকের বিক্রি (মোট)" value={taka(data.todayRevenuePoisha)} />
            <Stat label="দেরি হওয়া অর্ডার" value={String(data.lateOrders)} tone={data.lateOrders ? 'bad' : undefined} href="/orders" />
            <Stat label="কম স্টক" value={String(data.lowStockItems)} tone={data.lowStockItems ? 'warn' : undefined} href="/inventory" />
          </section>
          <h2 className="mb-2 font-semibold">চলমান অর্ডার</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {OPEN.map((st) => (
              <li key={st}>
                <Link href={`/orders?status=${st}`} className="card block p-3 hover:bg-brand-100">
                  <p className="text-sm text-muted">{ORDER_STATUS[st]}</p>
                  <p className="text-2xl font-bold text-brand-700">{data.openByStatus[st] ?? 0}</p>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">তারিখ: {data.date} (Asia/Dhaka)। বিক্রির হিসাবে বাতিল, প্রত্যাখ্যাত ও পেমেন্ট-বাকি অনলাইন অর্ডার ধরা হয় না।</p>
        </>
      )}
    </>
  );
}

function Stat({ label, value, tone, href }: { label: string; value: string; tone?: 'bad' | 'warn'; href?: string }) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-2xl font-bold ${tone === 'bad' ? 'text-danger' : tone === 'warn' ? 'text-warning' : 'text-brand-700'}`}>{value}</p>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 hover:bg-brand-100">
      {body}
    </Link>
  ) : (
    <div className="card p-4">{body}</div>
  );
}
