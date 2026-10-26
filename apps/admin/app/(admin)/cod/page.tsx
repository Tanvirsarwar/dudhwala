'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime, taka, toPoisha, COD_STATUS } from '@/lib/format';
import { CodBadge, Empty, Field, Loading, Modal, Msg, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

interface Cod {
  id: string;
  status: string;
  expectedPoisha: number;
  collectedPoisha: number | null;
  collectedAt: string | null;
  collectedById: string | null;
  note: string | null;
  delivery: { order: { id: string; orderNumber: string }; rider: { id: string; fullName: string | null } | null };
}

/** End-of-shift cash: the manager confirms cash received from each rider (separation of duties). */
export default function CodPage() {
  const s = useSession();
  const [status, setStatus] = useState('COLLECTED');
  const { data, error, reload } = useLoad<Cod[]>(s.outletId ? `/admin/outlets/${s.outletId}/cod${status ? `?status=${status}` : ''}` : null);
  const [resolving, setResolving] = useState<Cod | null>(null);
  const a = useAction();
  if (!s.outletId) return <NeedOutlet />;

  const byRider = new Map<string, number>();
  for (const c of data ?? []) if (c.status === 'COLLECTED') byRider.set(c.delivery.rider?.fullName ?? '—', (byRider.get(c.delivery.rider?.fullName ?? '—') ?? 0) + (c.collectedPoisha ?? 0));

  return (
    <>
      <PageTitle title="ক্যাশ (COD) জমা">
        <label className="flex items-center gap-2 text-sm">
          <span>অবস্থা</span>
          <select className="field field-sm w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">সব</option>
            {Object.entries(COD_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </PageTitle>
      <Msg error={a.error} ok={a.ok} />
      {byRider.size ? (
        <ul className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="রাইডার অনুযায়ী জমা বাকি">
          {[...byRider].map(([r, total]) => (
            <li key={r} className="card px-3 py-2">
              {r}: <strong className="font-latin">{taka(total)}</strong>
            </li>
          ))}
        </ul>
      ) : null}
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>কিছু নেই।</Empty>
      ) : (
        <TableWrap label="COD তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>অর্ডার</th>
                <th>রাইডার</th>
                <th className="text-right">প্রত্যাশিত</th>
                <th className="text-right">সংগৃহীত</th>
                <th>অবস্থা</th>
                <th>কাজ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="font-latin">
                    <a className="text-brand-600 underline" href={`/orders/${c.delivery.order.id}`}>
                      {c.delivery.order.orderNumber}
                    </a>
                    <div className="text-xs text-muted">{dateTime(c.collectedAt)}</div>
                  </td>
                  <td>{c.delivery.rider?.fullName ?? '—'}</td>
                  <td className="text-right font-latin">{taka(c.expectedPoisha)}</td>
                  <td className="text-right font-latin">{taka(c.collectedPoisha)}</td>
                  <td>
                    <CodBadge status={c.status} />
                    {c.note ? <div className="text-xs text-muted">{c.note}</div> : null}
                  </td>
                  <td>
                    {c.status === 'COLLECTED' ? (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={a.busy || c.collectedById === s.me.user.id}
                        title={c.collectedById === s.me.user.id ? 'নিজের সংগ্রহ নিজে নিশ্চিত করা যায় না' : undefined}
                        onClick={() => void a.run(() => api(`/admin/cod/${c.id}/confirm-handover`, { method: 'POST' }), `${c.delivery.order.orderNumber}: ক্যাশ জমা নিশ্চিত`).then((ok) => (ok ? reload() : undefined))}
                      >
                        ক্যাশ পেয়েছি
                      </button>
                    ) : null}
                    {c.status === 'DISCREPANCY' && s.can('cod.resolve_discrepancy') ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setResolving(c)}>
                        গরমিল মীমাংসা
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {resolving ? <Resolve cod={resolving} onClose={() => setResolving(null)} onDone={reload} /> : null}
    </>
  );
}

function Resolve({ cod, onClose, onDone }: { cod: Cod; onClose: () => void; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(String((cod.collectedPoisha ?? 0) / 100));
  const [note, setNote] = useState('');
  const a = useAction();
  const p = toPoisha(amount);
  return (
    <Modal open title="গরমিল মীমাংসা" onClose={onClose}>
      <p className="mb-3 text-sm">
        প্রত্যাশিত <strong className="font-latin">{taka(cod.expectedPoisha)}</strong>, রাইডার জানিয়েছেন <strong className="font-latin">{taka(cod.collectedPoisha)}</strong>।
      </p>
      <Field label="আসলে পাওয়া গেছে (৳)" id="c-amt">
        <input id="c-amt" className="field font-latin" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="নোট (আবশ্যক)" id="c-note">
        <textarea id="c-note" className="field" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Msg error={a.error} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          বাতিল
        </button>
        <button
          className="btn btn-primary"
          disabled={a.busy || p === null || note.trim().length < 3}
          onClick={() =>
            void a.run(() => api(`/admin/cod/${cod.id}/resolve`, { body: { receivedPoisha: p, note: note.trim() } })).then(async (ok) => {
              if (ok) {
                await onDone();
                onClose();
              }
            })
          }
        >
          সংরক্ষণ
        </button>
      </div>
    </Modal>
  );
}
