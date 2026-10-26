'use client';

import { useState } from 'react';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';
import { todayDhaka } from '@/lib/format';
import { Empty, Loading, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

/** What to pack for a delivery day: confirmed and preparing orders, summed by SKU. */
export default function PicklistPage() {
  const s = useSession();
  const [date, setDate] = useState(todayDhaka());
  const { data, error } = useLoad<{ date: string; lines: { sku: string; name: string; quantity: number }[] }>(s.outletId ? `/admin/outlets/${s.outletId}/picklist?date=${date}` : null);
  if (!s.outletId) return <NeedOutlet />;
  return (
    <>
      <PageTitle title="পিক লিস্ট">
        <label className="flex items-center gap-2 text-sm">
          <span>তারিখ</span>
          <input type="date" className="field field-sm" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
          প্রিন্ট
        </button>
      </PageTitle>
      <p className="mb-3 text-sm text-muted">নিশ্চিত ও প্রস্তুত-হচ্ছে অবস্থার অর্ডার থেকে যোগফল।</p>
      {!data ? (
        <Loading error={error} />
      ) : data.lines.length === 0 ? (
        <Empty>এই দিনে প্যাক করার মতো কোনো অর্ডার নেই।</Empty>
      ) : (
        <TableWrap label="পিক লিস্ট">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU</th>
                <th>পণ্য</th>
                <th className="text-right">পরিমাণ</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => (
                <tr key={l.sku}>
                  <td className="font-latin">{l.sku}</td>
                  <td>{l.name}</td>
                  <td className="text-right font-latin text-lg font-bold">{l.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
