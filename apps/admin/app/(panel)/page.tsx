'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { DemoOrderStatus, FulfilmentMethod } from '@dudhwala/shared';
import { METHOD_BN, ORDER_STATUS_BN, taka } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Empty, Loading, PageTitle, Stat, TableWrap } from '@/components/ui';
import { OrdersTable, type OrderRow } from '@/components/orders-table';

interface Summary {
  products: { total: number; active: number; hidden: number; noPrice: number; noImage: number; outOfStock: number; byCategory: { slug: string; nameBn: string; count: number; active: number }[] };
  orders: { total: number; today: number; open: number; byStatus: Record<string, number>; byMethod: Record<string, number>; itemsOrdered: number; knownRevenuePoisha: number; ordersWithUnknownPrice: number; latest: OrderRow[] };
}

export default function Dashboard() {
  const { data, error, reload } = useLoad<Summary>('/admin/summary');
  useEffect(() => {
    const t = setInterval(() => void reload(), 15_000); // new customer orders show up without a refresh
    return () => clearInterval(t);
  }, [reload]);
  if (!data) return <Loading error={error} />;
  const { products: p, orders: o } = data;

  return (
    <>
      <PageTitle title="ড্যাশবোর্ড" />
      <h2 className="mb-2 font-bold text-brand-700">অর্ডার</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="মোট অর্ডার" value={o.total} href="/orders" />
        <Stat label="আজকের অর্ডার" value={o.today} href="/orders" />
        <Stat label="চলমান (শেষ হয়নি)" value={o.open} href="/orders" tone={o.open ? 'warn' : undefined} />
        <Stat label="মোট পণ্য অর্ডার হয়েছে" value={o.itemsOrdered} />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section className="card p-4" aria-labelledby="by-method">
          <h3 id="by-method" className="mb-2 font-semibold">
            ধরন অনুযায়ী
          </h3>
          <ul className="grid gap-1 text-sm">
            {(Object.keys(METHOD_BN) as FulfilmentMethod[]).map((m) => (
              <li key={m} className="flex justify-between">
                <span>{METHOD_BN[m]}</span>
                <b>{o.byMethod[m] ?? 0}</b>
              </li>
            ))}
          </ul>
        </section>
        <section className="card p-4" aria-labelledby="by-status">
          <h3 id="by-status" className="mb-2 font-semibold">
            অবস্থা অনুযায়ী
          </h3>
          {Object.keys(o.byStatus).length === 0 ? (
            <p className="text-sm text-muted">এখনো কোনো অর্ডার আসেনি।</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {Object.entries(o.byStatus).map(([s, n]) => (
                <li key={s} className="flex justify-between gap-3">
                  <span>{ORDER_STATUS_BN[s as DemoOrderStatus] ?? s}</span>
                  <b>{n}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="mt-2 text-sm text-muted">
        <span>দাম জানা অর্ডারের মোট:</span> <b className="text-ink">{taka(o.knownRevenuePoisha)}</b>
        {o.ordersWithUnknownPrice > 0 && (
          <>
            {' · '}
            <span>দাম ছাড়া অর্ডার:</span> <b className="text-ink">{o.ordersWithUnknownPrice}</b>
          </>
        )}
      </p>

      <h2 className="mb-2 mt-6 font-bold text-brand-700">পণ্য</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="মোট পণ্য" value={p.total} href="/products" />
        <Stat label="দোকানে চালু" value={p.active} href="/products?status=active" />
        <Stat label="লুকানো" value={p.hidden} href="/products?status=hidden" />
        <Stat label="দাম দেওয়া হয়নি" value={p.noPrice} href="/products?status=noprice" tone={p.noPrice ? 'warn' : undefined} />
        <Stat label="ছবি নেই" value={p.noImage} href="/products?status=noimage" tone={p.noImage ? 'warn' : undefined} />
        <Stat label="স্টক শেষ" value={p.outOfStock} tone={p.outOfStock ? 'bad' : undefined} />
      </div>
      <TableWrap label="ক্যাটাগরি অনুযায়ী পণ্য">
        <table className="tbl mt-3">
          <thead>
            <tr>
              <th>ক্যাটাগরি</th>
              <th>মোট পণ্য</th>
              <th>চালু</th>
            </tr>
          </thead>
          <tbody>
            {p.byCategory.map((c) => (
              <tr key={c.slug}>
                <td>
                  <Link href={`/products?category=${c.slug}`} className="text-brand-600 underline">
                    {c.nameBn}
                  </Link>
                </td>
                <td>{c.count}</td>
                <td>{c.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <h2 className="mb-2 mt-6 font-bold text-brand-700">সাম্প্রতিক অর্ডার</h2>
      {o.latest.length === 0 ? (
        <Empty>এখনো কোনো অর্ডার আসেনি। দোকান থেকে অর্ডার দিলে এখানে দেখা যাবে।</Empty>
      ) : (
        <OrdersTable rows={o.latest} />
      )}
    </>
  );
}
