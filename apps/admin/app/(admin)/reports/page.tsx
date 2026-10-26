'use client';

import { useState } from 'react';
import { download } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { COD_STATUS, taka, todayDhaka } from '@/lib/format';
import { Empty, Loading, Msg, PageTitle, TableWrap } from '@/components/ui';

type Kind = 'sales' | 'inventory' | 'delivery' | 'cod';
const KINDS: { k: Kind; label: string }[] = [
  { k: 'sales', label: 'বিক্রি' },
  { k: 'inventory', label: 'স্টক' },
  { k: 'delivery', label: 'ডেলিভারি' },
  { k: 'cod', label: 'COD' },
];

const COLUMNS: Record<Kind, { key: string; label: string; money?: boolean; num?: boolean }[]> = {
  sales: [
    { key: 'day', label: 'দিন' },
    { key: 'outlet', label: 'আউটলেট' },
    { key: 'orders', label: 'অর্ডার', num: true },
    { key: 'grossPoisha', label: 'মোট বিক্রি', money: true },
    { key: 'discountPoisha', label: 'ছাড়', money: true },
    { key: 'deliveryFeePoisha', label: 'ডেলিভারি ফি', money: true },
    { key: 'codOrders', label: 'COD', num: true },
    { key: 'onlineOrders', label: 'অনলাইন', num: true },
  ],
  inventory: [
    { key: 'outlet', label: 'আউটলেট' },
    { key: 'sku', label: 'SKU' },
    { key: 'name', label: 'পণ্য' },
    { key: 'onHand', label: 'হাতে', num: true },
    { key: 'reserved', label: 'সংরক্ষিত', num: true },
    { key: 'available', label: 'অবশিষ্ট', num: true },
  ],
  delivery: [
    { key: 'outcome', label: 'ফলাফল' },
    { key: 'attempts', label: 'চেষ্টা', num: true },
  ],
  cod: [
    { key: 'status', label: 'অবস্থা' },
    { key: 'count', label: 'সংখ্যা', num: true },
    { key: 'expectedPoisha', label: 'প্রত্যাশিত', money: true },
    { key: 'collectedPoisha', label: 'সংগৃহীত', money: true },
  ],
};

export default function ReportsPage() {
  const s = useSession();
  const [kind, setKind] = useState<Kind>('sales');
  const today = todayDhaka();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const params = new URLSearchParams({ from, to });
  if (s.outletId) params.set('outletId', s.outletId);
  const path = `/admin/reports/${kind}?${params}`;
  const { data, error } = useLoad<{ data: Record<string, string | number | boolean>[] }>(path);
  const dl = useAction();
  const cols = COLUMNS[kind];
  const totals = (data?.data ?? []).reduce<Record<string, number>>((acc, r) => {
    for (const c of cols) if (c.money || c.num) acc[c.key] = (acc[c.key] ?? 0) + Number(r[c.key] ?? 0);
    return acc;
  }, {});

  return (
    <>
      <PageTitle title="রিপোর্ট">
        {s.can('orders.export_csv') ? (
          <button className="btn btn-ghost btn-sm" disabled={dl.busy} onClick={() => void dl.run(() => download(`${path}&format=csv`, `dudhwala-${kind}.csv`))}>
            CSV ডাউনলোড
          </button>
        ) : null}
      </PageTitle>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div className="flex gap-1" role="tablist" aria-label="রিপোর্টের ধরন">
          {KINDS.map((x) => (
            <button key={x.k} role="tab" aria-selected={kind === x.k} className={`btn btn-sm ${kind === x.k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setKind(x.k)}>
              {x.label}
            </button>
          ))}
        </div>
        {kind !== 'inventory' ? (
          <>
            <label className="text-sm">
              <span className="label">থেকে</span>
              <input type="date" className="field field-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="label">পর্যন্ত</span>
              <input type="date" className="field field-sm" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-muted">{s.outletId ? 'নির্বাচিত আউটলেট' : 'সব আউটলেট একত্রে'} · তারিখ Asia/Dhaka অনুযায়ী · বিক্রিতে বাতিল/প্রত্যাখ্যাত/পেমেন্ট-বাকি অর্ডার ধরা হয় না।</p>
      <Msg error={dl.error} />
      {!data ? (
        <Loading error={error} />
      ) : data.data.length === 0 ? (
        <Empty>এই সময়ে কোনো তথ্য নেই।</Empty>
      ) : (
        <TableWrap label="রিপোর্ট">
          <table className="tbl">
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.key} className={c.money || c.num ? 'text-right' : ''}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.money || c.num ? 'text-right font-latin' : c.key === 'sku' || c.key === 'day' ? 'font-latin' : ''}>
                      {c.money ? taka(Number(r[c.key])) : c.key === 'status' ? COD_STATUS[String(r[c.key])] ?? String(r[c.key]) : String(r[c.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {kind !== 'inventory' ? (
              <tfoot>
                <tr className="font-semibold">
                  {cols.map((c, i) => (
                    <td key={c.key} className={c.money || c.num ? 'text-right font-latin' : ''}>
                      {i === 0 ? 'মোট' : c.money ? taka(totals[c.key] ?? 0) : c.num ? totals[c.key] : ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </TableWrap>
      )}
    </>
  );
}
