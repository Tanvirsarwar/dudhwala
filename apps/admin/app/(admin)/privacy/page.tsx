'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/format';
import { Empty, Loading, Msg, PageTitle, TableWrap } from '@/components/ui';

interface PrivacyReq {
  id: string;
  status: string;
  note: string | null;
  createdAt: string;
  processedAt: string | null;
  openOrders: number;
  user: { phone: string | null; fullName: string | null };
}

/** Customer account-deletion requests (Super Admin). Completing anonymises the account; order amounts stay for accounting. */
export default function PrivacyPage() {
  const [status, setStatus] = useState('REQUESTED');
  const { data, error, reload } = useLoad<PrivacyReq[]>(`/admin/privacy-requests?status=${status}`);
  const a = useAction();
  const decide = (r: PrivacyReq, decision: 'COMPLETE' | 'REJECT') => {
    const text =
      decision === 'COMPLETE'
        ? 'গ্রাহকের নাম, ফোন, ঠিকানা স্থায়ীভাবে মুছে যাবে (অর্ডারের টাকার হিসাব থাকবে)। এটি ফেরানো যাবে না। চালিয়ে যাবেন?'
        : 'অনুরোধ প্রত্যাখ্যান করবেন?';
    if (!window.confirm(text)) return;
    void a.run(() => api(`/admin/privacy-requests/${r.id}/process`, { body: { decision } }), decision === 'COMPLETE' ? 'অ্যাকাউন্ট মুছে ফেলা হয়েছে' : 'প্রত্যাখ্যাত').then((ok) => (ok ? reload() : undefined));
  };
  return (
    <>
      <PageTitle title="গ্রাহকের তথ্য মুছে ফেলার অনুরোধ">
        <select className="field field-sm w-auto" aria-label="অবস্থা" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="REQUESTED">অপেক্ষমাণ</option>
          <option value="COMPLETED">সম্পন্ন</option>
          <option value="REJECTED">প্রত্যাখ্যাত</option>
        </select>
      </PageTitle>
      <p className="mb-3 text-sm text-muted">চলমান অর্ডার থাকলে আগে সেগুলো শেষ বা বাতিল করতে হবে। তথ্য রাখার মেয়াদ আইনি পরামর্শে চূড়ান্ত হবে (OPEN_DECISIONS F6)।</p>
      <Msg error={a.error} ok={a.ok} />
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>কোনো অনুরোধ নেই।</Empty>
      ) : (
        <TableWrap label="অনুরোধের তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>তারিখ</th>
                <th>গ্রাহক</th>
                <th>নোট</th>
                <th>চলমান অর্ডার</th>
                <th>কাজ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="font-latin">{dateTime(r.createdAt)}</td>
                  <td>
                    {r.user.fullName ?? '—'}
                    <div className="font-latin text-xs text-muted">{r.user.phone ?? 'মুছে ফেলা'}</div>
                  </td>
                  <td className="text-sm">{r.note ?? '—'}</td>
                  <td className="font-latin">{r.openOrders}</td>
                  <td className="space-x-1 whitespace-nowrap">
                    {r.status === 'REQUESTED' ? (
                      <>
                        <button className="btn btn-primary btn-sm" disabled={a.busy || r.openOrders > 0} title={r.openOrders > 0 ? 'চলমান অর্ডার আগে শেষ করুন' : undefined} onClick={() => decide(r, 'COMPLETE')}>
                          মুছে ফেলুন
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => decide(r, 'REJECT')}>
                          প্রত্যাখ্যান
                        </button>
                      </>
                    ) : (
                      <span className="font-latin text-xs text-muted">{dateTime(r.processedAt)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </>
  );
}
