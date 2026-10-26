'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/format';
import { Badge, Empty, Loading, Msg, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

interface CountSummary {
  id: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  completedAt: string | null;
  _count: { lines: number };
}
interface CountDetail extends Omit<CountSummary, '_count'> {
  lines: { variantId: string; sku: string; name: string; systemQty: number; countedQty: number | null; difference: number | null }[];
}

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  OPEN: { label: 'চলছে', tone: 'warn' },
  COMPLETED: { label: 'সম্পন্ন', tone: 'good' },
  CANCELLED: { label: 'বাতিল', tone: 'neutral' },
};

/** Physical stock count: snapshot → enter counted quantities → manager completes (posts adjustments). */
export default function StockCountsPage() {
  const s = useSession();
  const base = s.outletId ? `/admin/outlets/${s.outletId}/stock-counts` : null;
  const list = useLoad<CountSummary[]>(base);
  const open = list.data?.find((c) => c.status === 'OPEN');
  const [viewId, setViewId] = useState<string | null>(null);
  const shownId = viewId ?? open?.id ?? null;
  const detail = useLoad<CountDetail>(base && shownId ? `${base}/${shownId}` : null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const a = useAction();

  useEffect(() => {
    if (!detail.data) return;
    setCounted(Object.fromEntries(detail.data.lines.map((l) => [l.variantId, l.countedQty == null ? '' : String(l.countedQty)])));
  }, [detail.data]);

  if (!s.outletId) return <NeedOutlet />;
  const canComplete = s.me.role !== 'OUTLET_STAFF';
  const d = detail.data;
  const editable = d?.status === 'OPEN' && s.can('inventory.count');

  const save = async () => {
    const lines = Object.entries(counted)
      .filter(([, v]) => v.trim() !== '' && /^\d+$/.test(v.trim()))
      .map(([variantId, v]) => ({ variantId, countedQty: Number(v) }));
    if (lines.length) await api(`${base}/${d?.id}/lines`, { method: 'PUT', body: { lines } });
  };

  return (
    <>
      <PageTitle title="স্টক গণনা">
        {!open && s.can('inventory.count') ? (
          <button
            className="btn btn-primary"
            disabled={a.busy}
            onClick={() =>
              void a
                .run(async () => {
                  const r = await api<{ id: string }>(base as string, { method: 'POST' });
                  setViewId(r.id);
                }, 'গণনা শুরু হয়েছে। এই মুহূর্তের সিস্টেম স্টক সংরক্ষিত হয়েছে।')
                .then(() => list.reload())
            }
          >
            নতুন গণনা শুরু
          </button>
        ) : null}
      </PageTitle>
      <Msg error={a.error} ok={a.ok} />

      {!list.data ? (
        <Loading error={list.error} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <section className="card p-3" aria-label="গণনার তালিকা">
            {list.data.length === 0 ? (
              <p className="text-sm text-muted">এখনো কোনো গণনা হয়নি।</p>
            ) : (
              <ul className="space-y-1">
                {list.data.map((c) => (
                  <li key={c.id}>
                    <button className={`w-full rounded-lg px-2 py-2 text-left text-sm ${c.id === shownId ? 'bg-brand-100' : 'hover:bg-brand-100'}`} onClick={() => setViewId(c.id)} aria-current={c.id === shownId ? 'true' : undefined}>
                      <span className="font-latin">{dateTime(c.createdAt)}</span> <Badge tone={STATUS[c.status]?.tone}>{STATUS[c.status]?.label}</Badge>
                      <span className="block text-xs text-muted">{c._count.lines}টি পণ্য</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="গণনার বিস্তারিত">
            {!shownId ? (
              <Empty>বাম দিক থেকে একটি গণনা বেছে নিন, অথবা নতুন গণনা শুরু করুন।</Empty>
            ) : !d ? (
              <Loading error={detail.error} />
            ) : (
              <>
                <p className="mb-2 text-sm text-muted">
                  গোনা সংখ্যা লিখুন। যেগুলো খালি থাকবে সেগুলোর স্টক বদলাবে না। সম্পন্ন করলে প্রতিটি পার্থক্য একটি স্টক সমন্বয় হিসেবে লেখা হবে; গণনার সময় হওয়া বিক্রি মুছে যাবে না।
                </p>
                <TableWrap label="গণনার লাইন">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>পণ্য</th>
                        <th className="text-right">সিস্টেমে ছিল</th>
                        <th className="text-right">গোনা হয়েছে</th>
                        <th className="text-right">পার্থক্য</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.lines.map((l) => {
                        const v = counted[l.variantId] ?? '';
                        const diff = /^\d+$/.test(v.trim()) ? Number(v) - l.systemQty : null;
                        return (
                          <tr key={l.variantId}>
                            <td>
                              {l.name}
                              <div className="font-latin text-xs text-muted">{l.sku}</div>
                            </td>
                            <td className="text-right font-latin">{l.systemQty}</td>
                            <td className="text-right">
                              {editable ? (
                                <input
                                  aria-label={`${l.name} গোনা সংখ্যা`}
                                  className="field field-sm w-24 text-right font-latin"
                                  inputMode="numeric"
                                  value={v}
                                  onChange={(e) => setCounted((x) => ({ ...x, [l.variantId]: e.target.value }))}
                                />
                              ) : (
                                <span className="font-latin">{l.countedQty ?? '—'}</span>
                              )}
                            </td>
                            <td className={`text-right font-latin ${diff && diff < 0 ? 'text-danger' : diff && diff > 0 ? 'text-success' : ''}`}>{diff == null ? '—' : diff > 0 ? `+${diff}` : diff}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
                {editable ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button className="btn btn-ghost" disabled={a.busy} onClick={() => void a.run(save, 'সংরক্ষিত').then(() => detail.reload())}>
                      সংরক্ষণ
                    </button>
                    {canComplete ? (
                      <>
                        <button
                          className="btn btn-primary"
                          disabled={a.busy}
                          onClick={() => {
                            if (!window.confirm('গণনা সম্পন্ন করবেন? পার্থক্যগুলো স্টকে সমন্বয় হবে এবং এটি আর বদলানো যাবে না।')) return;
                            void a
                              .run(async () => {
                                await save();
                                await api(`${base}/${d.id}/complete`, { method: 'POST' });
                              }, 'গণনা সম্পন্ন, স্টক সমন্বয় হয়েছে')
                              .then(async () => {
                                await list.reload();
                                await detail.reload();
                              });
                          }}
                        >
                          সম্পন্ন করুন
                        </button>
                        <button
                          className="btn btn-ghost"
                          disabled={a.busy}
                          onClick={() => {
                            if (!window.confirm('গণনা বাতিল করবেন? কোনো স্টক বদলাবে না।')) return;
                            void a.run(() => api(`${base}/${d.id}/cancel`, { method: 'POST' }), 'গণনা বাতিল').then(async () => {
                              await list.reload();
                              await detail.reload();
                            });
                          }}
                        >
                          বাতিল
                        </button>
                      </>
                    ) : (
                      <p className="self-center text-sm text-muted">ম্যানেজার গণনা সম্পন্ন করবেন।</p>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
