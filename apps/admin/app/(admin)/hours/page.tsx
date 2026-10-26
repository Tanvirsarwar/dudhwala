'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { WEEKDAYS, todayDhaka } from '@/lib/format';
import { Empty, Field, Loading, Msg, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

interface Hours {
  hours: { weekday: number; opensAt: string; closesAt: string }[];
  closures: { date: string; reason: string }[];
}
interface ClosureResult {
  closedEmptySlots: number;
  slotsWithOrders: { slotId: string; startsAt: string; orders: number }[];
}

type Row = { open: boolean; opensAt: string; closesAt: string };

/** Weekly opening hours (bound delivery slots) and closure days for the active outlet. */
export default function HoursPage() {
  const s = useSession();
  const { data, error, reload } = useLoad<Hours>(s.outletId ? `/admin/outlets/${s.outletId}/hours` : null);
  const canEdit = s.can('outlets.hours_manage');
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState(todayDhaka());
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<ClosureResult | null>(null);
  const a = useAction();

  useEffect(() => {
    if (!data) return;
    setRows(
      WEEKDAYS.map((_, wd) => {
        const h = data.hours.find((x) => x.weekday === wd);
        return h ? { open: true, opensAt: h.opensAt, closesAt: h.closesAt } : { open: false, opensAt: '09:00', closesAt: '21:00' };
      }),
    );
  }, [data]);

  if (!s.outletId) return <NeedOutlet />;
  const noneSet = data && data.hours.length === 0;

  return (
    <>
      <PageTitle title="খোলার সময় ও ছুটির দিন" />
      <Msg error={a.error} ok={a.ok} />
      {!data ? (
        <Loading error={error} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4" aria-labelledby="h-week">
            <h2 id="h-week" className="mb-1 font-bold text-brand-700">
              সাপ্তাহিক সময়সূচি
            </h2>
            <p className="mb-3 text-sm text-muted">
              {noneSet
                ? 'এখনো কোনো সময় দেওয়া হয়নি — স্লট টেমপ্লেট অনুযায়ী সব স্লট তৈরি হচ্ছে।'
                : 'শুধু খোলা সময়ের ভেতরের ডেলিভারি স্লট তৈরি হবে। বন্ধ দিনে কোনো স্লট থাকবে না।'}
            </p>
            <TableWrap label="সাপ্তাহিক সময়">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>দিন</th>
                    <th>খোলা</th>
                    <th>শুরু</th>
                    <th>শেষ</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, wd) => (
                    <tr key={wd}>
                      <td>{WEEKDAYS[wd]}</td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`${WEEKDAYS[wd]} খোলা`}
                          checked={r.open}
                          disabled={!canEdit}
                          onChange={(e) => setRows((x) => x.map((y, i) => (i === wd ? { ...y, open: e.target.checked } : y)))}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          aria-label={`${WEEKDAYS[wd]} শুরু`}
                          className="field field-sm font-latin"
                          value={r.opensAt}
                          disabled={!canEdit || !r.open}
                          onChange={(e) => setRows((x) => x.map((y, i) => (i === wd ? { ...y, opensAt: e.target.value } : y)))}
                        />
                      </td>
                      <td>
                        <input
                          type="time"
                          aria-label={`${WEEKDAYS[wd]} শেষ`}
                          className="field field-sm font-latin"
                          value={r.closesAt}
                          disabled={!canEdit || !r.open}
                          onChange={(e) => setRows((x) => x.map((y, i) => (i === wd ? { ...y, closesAt: e.target.value } : y)))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            {canEdit ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  disabled={a.busy}
                  onClick={() =>
                    void a
                      .run(
                        () => api(`/admin/outlets/${s.outletId}/hours`, { method: 'PUT', body: { hours: rows.flatMap((r, wd) => (r.open ? [{ weekday: wd, opensAt: r.opensAt, closesAt: r.closesAt }] : [])) } }),
                        'সময়সূচি সংরক্ষিত। নতুন স্লট এই সময় অনুযায়ী তৈরি হবে।',
                      )
                      .then((ok) => (ok ? reload() : undefined))
                  }
                >
                  সংরক্ষণ
                </button>
                {!noneSet ? (
                  <button
                    className="btn btn-ghost"
                    disabled={a.busy}
                    onClick={() => {
                      if (!window.confirm('সব সময় মুছে ফেলবেন? স্লট তখন শুধু টেমপ্লেট অনুযায়ী তৈরি হবে।')) return;
                      void a.run(() => api(`/admin/outlets/${s.outletId}/hours`, { method: 'PUT', body: { hours: [] } }), 'সময়সূচি মুছে ফেলা হয়েছে').then((ok) => (ok ? reload() : undefined));
                    }}
                  >
                    সব সময় মুছুন
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="card p-4" aria-labelledby="h-closed">
            <h2 id="h-closed" className="mb-3 font-bold text-brand-700">
              ছুটির দিন
            </h2>
            {canEdit ? (
              <div className="mb-3 grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
                <Field label="তারিখ" id="cl-date">
                  <input id="cl-date" type="date" className="field font-latin" value={date} min={todayDhaka()} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="কারণ" id="cl-reason">
                  <input id="cl-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: ঈদের ছুটি" />
                </Field>
                <button
                  className="btn btn-primary mb-3"
                  disabled={a.busy || reason.trim().length < 2}
                  onClick={() =>
                    void a
                      .run(async () => {
                        setResult(await api<ClosureResult>(`/admin/outlets/${s.outletId}/closures`, { body: { date, reason: reason.trim() } }));
                      }, 'ছুটির দিন যোগ হয়েছে')
                      .then((ok) => {
                        if (ok) {
                          setReason('');
                          void reload();
                        }
                      })
                  }
                >
                  যোগ করুন
                </button>
              </div>
            ) : null}
            {result && result.slotsWithOrders.length > 0 ? (
              <p role="alert" className="mb-3 rounded-lg bg-[#fff4cc] p-3 text-sm">
                এই দিনে {result.slotsWithOrders.reduce((n, x) => n + x.orders, 0)}টি অর্ডার আগে থেকেই বুক করা আছে। স্লটগুলো নতুন বুকিংয়ের জন্য বন্ধ করা হয়েছে, কিন্তু অর্ডারগুলো বাতিল হয়নি — অর্ডার পাতায় গিয়ে নতুন সময়ে রিশিডিউল করুন বা গ্রাহককে ফোন করুন।
              </p>
            ) : null}
            {data.closures.length === 0 ? (
              <Empty>কোনো ছুটির দিন নেই।</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {data.closures.map((c) => (
                  <li key={c.date} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="font-latin">{c.date}</span> — {c.reason}
                    </span>
                    {canEdit ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={a.busy}
                        onClick={() =>
                          void a.run(() => api(`/admin/outlets/${s.outletId}/closures/${c.date}`, { method: 'DELETE' }), 'ছুটি বাতিল। বন্ধ স্লট দরকার হলে ডেলিভারি পাতা থেকে আবার খুলুন।').then((ok) => (ok ? reload() : undefined))
                        }
                      >
                        মুছুন
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
