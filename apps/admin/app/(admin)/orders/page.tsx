'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { ORDER_STATUS, slot, taka, todayDhaka } from '@/lib/format';
import { Badge, Empty, Loading, OrderBadge, PageTitle, PaymentBadge, TableWrap } from '@/components/ui';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  totalPoisha: number;
  slotStartsAt: string;
  slotEndsAt: string;
  createdAt: string;
  shipName: string;
  shipAreaNameBn: string;
  outlet: { id: string; code: string };
  delivery: { status: string; riderUserId: string | null } | null;
  _count: { items: number };
  late: boolean;
}

const TABS = ['', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'PENDING_PAYMENT', 'DELIVERED', 'CANCELLED'];

export default function OrdersPage() {
  const s = useSession();
  const router = useRouter();
  const sp = useSearchParams();
  const status = sp.get('status') ?? '';
  const date = sp.get('date') ?? '';
  const page = Number(sp.get('page') ?? '1');
  const [q, setQ] = useState(sp.get('q') ?? '');
  useEffect(() => setQ(sp.get('q') ?? ''), [sp]);

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (date) params.set('date', date);
  if (sp.get('q')) params.set('q', sp.get('q') as string);
  if (page > 1) params.set('page', String(page));
  const base = s.outletId ? `/admin/outlets/${s.outletId}/orders` : '/admin/orders';
  const { data, error, reload, loading } = useLoad<{ data: OrderRow[]; total: number; page: number }>(`${base}?${params}`);

  // Auto-refresh the board every 30 s so new orders appear without a manual reload.
  useEffect(() => {
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const go = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('page' in patch)) p.delete('page');
    router.push(`/orders?${p}`);
  };

  return (
    <>
      <PageTitle title="অর্ডার">
        <button className="btn btn-ghost btn-sm" onClick={() => void reload()} disabled={loading}>
          রিফ্রেশ
        </button>
      </PageTitle>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" role="tablist" aria-label="স্ট্যাটাস অনুযায়ী">
        {TABS.map((t) => (
          <button key={t || 'all'} role="tab" aria-selected={status === t} className={`btn btn-sm shrink-0 ${status === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => go({ status: t })}>
            {t ? ORDER_STATUS[t] : 'সব'}
          </button>
        ))}
      </div>

      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go({ q });
        }}
      >
        <label className="text-sm">
          <span className="label">ডেলিভারির তারিখ</span>
          <input type="date" className="field field-sm" value={date} onChange={(e) => go({ date: e.target.value })} />
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => go({ date: todayDhaka() })}>
          আজ
        </button>
        <label className="text-sm">
          <span className="label">অর্ডার নম্বর বা মোবাইল</span>
          <input className="field field-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="DW-… / 017…" />
        </label>
        <button className="btn btn-ghost btn-sm">খুঁজুন</button>
      </form>

      {!data ? (
        <Loading error={error} />
      ) : data.data.length === 0 ? (
        <Empty>এই ফিল্টারে কোনো অর্ডার নেই।</Empty>
      ) : (
        <>
          <TableWrap label="অর্ডার তালিকা">
            <table className="tbl">
              <thead>
                <tr>
                  <th>অর্ডার</th>
                  {s.outletId ? null : <th>আউটলেট</th>}
                  <th>স্লট</th>
                  <th>গ্রাহক / এলাকা</th>
                  <th>স্ট্যাটাস</th>
                  <th>পেমেন্ট</th>
                  <th className="text-right">মোট</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-latin font-semibold text-brand-600 underline">
                        {o.orderNumber}
                      </Link>
                      <div className="text-xs text-muted">{o._count.items} আইটেম</div>
                    </td>
                    {s.outletId ? null : <td className="font-latin">{o.outlet.code}</td>}
                    <td className="whitespace-nowrap font-latin">
                      {slot(o.slotStartsAt, o.slotEndsAt)}
                      {o.late ? (
                        <div>
                          <Badge tone="bad">দেরি</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {o.shipName}
                      <div className="text-xs text-muted">{o.shipAreaNameBn}</div>
                    </td>
                    <td>
                      <OrderBadge status={o.status} />
                      {o.delivery?.riderUserId ? <div className="text-xs text-muted">রাইডার নির্ধারিত</div> : null}
                    </td>
                    <td>
                      <PaymentBadge status={o.paymentStatus} method={o.paymentMethod} />
                    </td>
                    <td className="text-right font-latin">{taka(o.totalPoisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <nav aria-label="পাতা" className="mt-3 flex items-center gap-2 text-sm">
            <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => go({ page: String(page - 1) })}>
              আগের
            </button>
            <span className="font-latin">
              {page} / {Math.max(1, Math.ceil(data.total / 50))} · {data.total}
            </span>
            <button className="btn btn-ghost btn-sm" disabled={page * 50 >= data.total} onClick={() => go({ page: String(page + 1) })}>
              পরের
            </button>
          </nav>
        </>
      )}
    </>
  );
}
