'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime, taka } from '@/lib/format';
import { Badge, Empty, Loading, Modal, Msg, PageTitle, PaymentBadge, TableWrap } from '@/components/ui';

interface Payment {
  id: string;
  status: string;
  amountPoisha: number;
  paidAmountPoisha: number | null;
  refundedPoisha: number;
  merchantTranId: string;
  providerTranId: string | null;
  provider: string | null;
  duplicateCapture: boolean;
  createdAt: string;
  order: { orderNumber: string };
}
interface Exceptions {
  stalePending: Payment[];
  duplicateCaptures: Payment[];
  refunds: { id: string; amountPoisha: number; reason: string; status: string; createdAt: string; payment: { merchantTranId: string; order: { orderNumber: string } } }[];
  codDiscrepancies: { id: string; expectedPoisha: number; collectedPoisha: number | null; note: string | null; delivery: { order: { orderNumber: string } } }[];
}
interface PaymentDetail extends Payment {
  events: { id: string; kind: string; signatureValid: boolean | null; providerEventId: string; receivedAt: string; processingResult: string | null }[];
  refunds: { id: string; amountPoisha: number; status: string; reason: string }[];
}

const REFUND: Record<string, string> = { REQUESTED: 'অনুরোধ', SUBMITTED: 'পাঠানো হয়েছে', SUCCEEDED: 'সফল', FAILED: 'ব্যর্থ' };

/** Online payments: reconciliation queue, manual re-verification and refunds (Super Admin). */
export default function PaymentsPage() {
  const s = useSession();
  const ex = useLoad<Exceptions>('/admin/reconciliation/exceptions');
  const [status, setStatus] = useState('');
  const list = useLoad<Payment[]>(`/admin/payments${status ? `?status=${status}` : ''}`);
  const [detail, setDetail] = useState<string | null>(null);
  const a = useAction();

  const verify = (p: Payment) =>
    void a.run(async () => {
      const r = await api<{ result: unknown }>(`/admin/payments/${p.id}/verify`, { method: 'POST' });
      a.setOk(`${p.order.orderNumber}: যাচাইয়ের ফল — ${JSON.stringify(r.result)}`);
    }).then(() => Promise.all([ex.reload(), list.reload()]));

  return (
    <>
      <PageTitle title="পেমেন্ট ও রিফান্ড" />
      <p className="mb-3 text-sm text-muted">পেমেন্ট “পরিশোধিত” হয় শুধু গেটওয়ের সাথে সার্ভার-যাচাইয়ের পরে। ব্রাউজারের রিডাইরেক্ট কখনো পেমেন্ট নিশ্চিত করে না।</p>
      <Msg error={a.error} ok={a.ok} />

      <section aria-labelledby="h-ex" className="mb-6">
        <h2 id="h-ex" className="mb-2 font-semibold">
          মনোযোগ দরকার
        </h2>
        {!ex.data ? (
          <Loading error={ex.error} />
        ) : ex.data.stalePending.length + ex.data.duplicateCaptures.length + ex.data.refunds.length + ex.data.codDiscrepancies.length === 0 ? (
          <Empty>কোনো ব্যতিক্রম নেই।</Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {ex.data.refunds.length ? (
              <div className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">রিফান্ড অনুরোধ</h3>
                <ul className="space-y-2 text-sm">
                  {ex.data.refunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="font-latin">{r.payment.order.orderNumber}</span> · <span className="font-latin">{taka(r.amountPoisha)}</span> · <Badge tone={r.status === 'FAILED' ? 'bad' : 'warn'}>{REFUND[r.status] ?? r.status}</Badge>
                        <span className="block text-xs text-muted">{r.reason}</span>
                      </span>
                      {s.can('payments.refund') && r.status !== 'SUBMITTED' ? (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={a.busy}
                          onClick={() => {
                            if (window.confirm(`${r.payment.order.orderNumber}: ${taka(r.amountPoisha)} গ্রাহককে ফেরত দেবেন?`))
                              void a.run(() => api(`/admin/refunds/${r.id}/execute`, { method: 'POST' }), 'রিফান্ড প্রক্রিয়া করা হয়েছে').then(() => ex.reload());
                          }}
                        >
                          রিফান্ড দিন
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ex.data.stalePending.length ? (
              <div className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">৩০ মিনিটের বেশি যাচাই-বাকি</h3>
                <ul className="space-y-2 text-sm">
                  {ex.data.stalePending.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <span className="font-latin">
                        {p.order.orderNumber} · {taka(p.amountPoisha)}
                      </span>
                      <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => verify(p)}>
                        গেটওয়েতে আবার যাচাই
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ex.data.duplicateCaptures.length ? (
              <div className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">ডুপ্লিকেট পেমেন্ট</h3>
                <ul className="space-y-1 text-sm">
                  {ex.data.duplicateCaptures.map((p) => (
                    <li key={p.id} className="font-latin">
                      {p.order.orderNumber} · {taka(p.paidAmountPoisha)} —{' '}
                      <button className="text-brand-600 underline" onClick={() => setDetail(p.id)}>
                        বিস্তারিত
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {ex.data.codDiscrepancies.length ? (
              <div className="card p-3">
                <h3 className="mb-2 text-sm font-semibold">COD গরমিল</h3>
                <ul className="space-y-1 text-sm">
                  {ex.data.codDiscrepancies.map((c) => (
                    <li key={c.id}>
                      <span className="font-latin">
                        {c.delivery.order.orderNumber}: {taka(c.expectedPoisha)} এর জায়গায় {taka(c.collectedPoisha)}
                      </span>
                      {c.note ? <span className="text-muted"> — {c.note}</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted">মীমাংসা: আউটলেট বেছে “ক্যাশ (COD) জমা” পাতায়।</p>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section aria-labelledby="h-list">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="h-list" className="font-semibold">
            অনলাইন পেমেন্ট
          </h2>
          <select className="field field-sm w-auto" aria-label="অবস্থা" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">সব</option>
            {['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED'].map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        {!list.data ? (
          <Loading error={list.error} />
        ) : list.data.length === 0 ? (
          <Empty>কোনো অনলাইন পেমেন্ট নেই।</Empty>
        ) : (
          <TableWrap label="অনলাইন পেমেন্ট">
            <table className="tbl">
              <thead>
                <tr>
                  <th>অর্ডার</th>
                  <th>সময়</th>
                  <th>লেনদেন</th>
                  <th className="text-right">পরিমাণ</th>
                  <th>অবস্থা</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-latin">{p.order.orderNumber}</td>
                    <td className="font-latin">{dateTime(p.createdAt)}</td>
                    <td className="font-latin text-xs">
                      {p.merchantTranId}
                      {p.providerTranId ? <div className="text-muted">{p.providerTranId}</div> : null}
                    </td>
                    <td className="text-right font-latin">
                      {taka(p.amountPoisha)}
                      {p.refundedPoisha ? <div className="text-xs text-muted">ফেরত {taka(p.refundedPoisha)}</div> : null}
                    </td>
                    <td>
                      <PaymentBadge status={p.status} />
                    </td>
                    <td className="whitespace-nowrap">
                      {s.can('payments.read_raw_events') ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setDetail(p.id)}>
                          ঘটনা
                        </button>
                      ) : null}
                      {['PENDING', 'FAILED', 'CANCELLED'].includes(p.status) ? (
                        <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => verify(p)}>
                          যাচাই
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      {detail ? <Detail id={detail} onClose={() => setDetail(null)} /> : null}
    </>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useLoad<PaymentDetail>(`/admin/payments/${id}`);
  return (
    <Modal open title="পেমেন্টের ঘটনা" onClose={onClose}>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          <p className="mb-2 font-latin text-sm">
            {data.order.orderNumber} · {data.merchantTranId} · {data.provider}
          </p>
          <ol className="max-h-80 space-y-1 overflow-y-auto font-latin text-xs">
            {data.events.map((e) => (
              <li key={e.id}>
                {dateTime(e.receivedAt)} · {e.kind} · sig {e.signatureValid === null ? 'n/a' : e.signatureValid ? 'ok' : 'INVALID'} · {e.processingResult ?? 'unprocessed'}
              </li>
            ))}
          </ol>
          {data.refunds.length ? (
            <ul className="mt-3 text-sm">
              {data.refunds.map((r) => (
                <li key={r.id} className="font-latin">
                  Refund {taka(r.amountPoisha)} · {REFUND[r.status] ?? r.status} · {r.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Modal>
  );
}
