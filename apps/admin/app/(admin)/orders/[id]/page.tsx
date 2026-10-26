'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime, NEEDS_REASON, ORDER_STATUS, slot, taka, TRANSITION_LABEL } from '@/lib/format';
import { Badge, CodBadge, Field, Loading, Modal, Msg, OrderBadge, PageTitle, PaymentBadge, TableWrap } from '@/components/ui';

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  slotStartsAt: string;
  slotEndsAt: string;
  shipName: string;
  shipPhone: string;
  shipLine1: string;
  shipLine2: string | null;
  shipLandmark: string | null;
  shipInstructions: string | null;
  shipAreaNameBn: string;
  subtotalPoisha: number;
  discountPoisha: number;
  deliveryFeePoisha: number;
  totalPoisha: number;
  couponCode: string | null;
  cancelReason: string | null;
  createdAt: string;
  outlet: { id: string; code: string; nameBn: string };
  items: { id: string; productNameBn: string; variantLabelBn: string; sku: string; unitPricePoisha: number; quantity: number; lineTotalPoisha: number }[];
  events: { id: string; fromStatus: string | null; toStatus: string; actorRole: string; reason: string | null; createdAt: string }[];
  payments: { id: string; method: string; status: string; amountPoisha: number; paidAmountPoisha: number | null; refundedPoisha: number; verifiedAt: string | null; duplicateCapture: boolean }[];
  delivery: {
    id: string;
    status: string;
    rider: { id: string; fullName: string | null; phone: string | null } | null;
    attempts: { id: string; attemptNo: number; outcome: string; note: string | null; recordedAt: string }[];
    cod: { status: string; expectedPoisha: number; collectedPoisha: number | null; note: string | null } | null;
  } | null;
  allowedTransitions: string[];
}

interface Slot {
  id: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  bookedCount: number;
  status: string;
  cutoffAt: string;
}

const ATTEMPT: Record<string, string> = { DELIVERED: 'ডেলিভারি সম্পন্ন', CUSTOMER_UNAVAILABLE: 'গ্রাহক পাওয়া যায়নি', WRONG_ADDRESS: 'ভুল ঠিকানা', REFUSED: 'গ্রহণ করেননি', OTHER: 'অন্যান্য' };

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const { data: o, error, reload } = useLoad<OrderDetail>(`/admin/orders/${id}`);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [returned, setReturned] = useState<'RESTOCK' | 'WRITE_OFF' | ''>('');
  const [showReschedule, setShowReschedule] = useState(false);
  const act = useAction();

  if (!o) return <Loading error={error} />;

  const doTransition = async () => {
    if (!target) return;
    const ok = await act.run(
      () => api(`/admin/orders/${o.id}/transition`, { body: { to: target, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(returned ? { returnedGoods: returned } : {}) } }),
      `স্ট্যাটাস পরিবর্তন হয়েছে: ${ORDER_STATUS[target]}`,
    );
    if (ok) {
      setTarget(null);
      setReason('');
      setReturned('');
      await reload();
    }
  };

  const needsReturned = o.status === 'DELIVERY_FAILED' && target === 'CANCELLED';
  const canAssign = s.can('delivery.assign') && ['CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH'].includes(o.status);
  const canReschedule = s.can('orders.reschedule') && ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'DELIVERY_FAILED'].includes(o.status);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/orders" className="text-brand-600 underline">
          ← অর্ডার তালিকা
        </Link>
      </p>
      <PageTitle title={`অর্ডার ${o.orderNumber}`}>
        <OrderBadge status={o.status} />
        <PaymentBadge status={o.paymentStatus} method={o.paymentMethod} />
      </PageTitle>
      <Msg error={act.error} ok={act.ok} />

      <section aria-label="পরবর্তী ধাপ" className="card mb-4 p-4">
        <h2 className="mb-2 font-semibold">পরবর্তী ধাপ</h2>
        <div className="flex flex-wrap gap-2">
          {o.allowedTransitions.length === 0 && !canAssign && !canReschedule ? <p className="text-sm text-muted">এই অর্ডারে আপনার করার মতো কোনো ধাপ নেই।</p> : null}
          {o.allowedTransitions.map((t) => (
            <button
              key={t}
              className={`btn btn-sm ${['CANCELLED', 'REJECTED', 'DELIVERY_FAILED'].includes(t) ? 'btn-ghost text-danger' : 'btn-primary'}`}
              onClick={() => (NEEDS_REASON.has(t) || (o.status === 'DELIVERY_FAILED' && t === 'CANCELLED') ? setTarget(t) : void act.run(() => api(`/admin/orders/${o.id}/transition`, { body: { to: t } }), `স্ট্যাটাস পরিবর্তন হয়েছে: ${ORDER_STATUS[t]}`).then((ok) => (ok ? reload() : undefined)))}
              disabled={act.busy}
            >
              {TRANSITION_LABEL[t] ?? t}
            </button>
          ))}
          {canReschedule ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowReschedule(true)}>
              স্লট পরিবর্তন
            </button>
          ) : null}
        </div>
        {o.status === 'READY_FOR_DISPATCH' && !o.delivery?.rider ? <p className="mt-2 text-sm text-warning">পাঠানোর আগে একজন রাইডার নির্ধারণ করুন।</p> : null}
        {canAssign ? <AssignRider order={o} onDone={reload} /> : null}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4" aria-labelledby="h-delivery">
          <h2 id="h-delivery" className="mb-2 font-semibold">
            ডেলিভারি
          </h2>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">স্লট</dt>
            <dd className="font-latin">{slot(o.slotStartsAt, o.slotEndsAt)}</dd>
            <dt className="text-muted">আউটলেট</dt>
            <dd>
              {o.outlet.code} — {o.outlet.nameBn}
            </dd>
            <dt className="text-muted">প্রাপক</dt>
            <dd>{o.shipName}</dd>
            <dt className="text-muted">মোবাইল</dt>
            <dd className="font-latin">
              <a className="text-brand-600 underline" href={`tel:${o.shipPhone}`}>
                {o.shipPhone}
              </a>
            </dd>
            <dt className="text-muted">ঠিকানা</dt>
            <dd>
              {o.shipLine1}
              {o.shipLine2 ? `, ${o.shipLine2}` : ''}, {o.shipAreaNameBn}
              {o.shipLandmark ? <div className="text-muted">ল্যান্ডমার্ক: {o.shipLandmark}</div> : null}
            </dd>
            {o.shipInstructions ? (
              <>
                <dt className="text-muted">নির্দেশনা</dt>
                <dd>{o.shipInstructions}</dd>
              </>
            ) : null}
            <dt className="text-muted">রাইডার</dt>
            <dd>{o.delivery?.rider ? `${o.delivery.rider.fullName ?? ''} (${o.delivery.rider.phone ?? '—'})` : 'নির্ধারিত হয়নি'}</dd>
            {o.delivery?.cod ? (
              <>
                <dt className="text-muted">ক্যাশ (COD)</dt>
                <dd className="font-latin">
                  {taka(o.delivery.cod.expectedPoisha)} <CodBadge status={o.delivery.cod.status} />
                  {o.delivery.cod.collectedPoisha != null ? <span> · সংগৃহীত {taka(o.delivery.cod.collectedPoisha)}</span> : null}
                </dd>
              </>
            ) : null}
          </dl>
          {o.delivery?.attempts.length ? (
            <>
              <h3 className="mb-1 mt-3 text-sm font-semibold">ডেলিভারি চেষ্টা</h3>
              <ol className="space-y-1 text-sm">
                {o.delivery.attempts.map((a) => (
                  <li key={a.id}>
                    #{a.attemptNo} · {ATTEMPT[a.outcome] ?? a.outcome} · <span className="font-latin">{dateTime(a.recordedAt)}</span>
                    {a.note ? <span className="text-muted"> — {a.note}</span> : null}
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </section>

        <section className="card p-4" aria-labelledby="h-items">
          <h2 id="h-items" className="mb-2 font-semibold">
            পণ্য
          </h2>
          <TableWrap label="অর্ডারের পণ্য">
            <table className="tbl">
              <thead>
                <tr>
                  <th>পণ্য</th>
                  <th className="text-right">পরিমাণ</th>
                  <th className="text-right">মোট</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.productNameBn} — {i.variantLabelBn}
                      <div className="font-latin text-xs text-muted">
                        {i.sku} · {taka(i.unitPricePoisha)}
                      </div>
                    </td>
                    <td className="text-right font-latin">{i.quantity}</td>
                    <td className="text-right font-latin">{taka(i.lineTotalPoisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 text-sm font-latin">
            <dt>সাবটোটাল</dt>
            <dd className="text-right">{taka(o.subtotalPoisha)}</dd>
            {o.discountPoisha ? (
              <>
                <dt>ছাড় {o.couponCode ? `(${o.couponCode})` : ''}</dt>
                <dd className="text-right">−{taka(o.discountPoisha)}</dd>
              </>
            ) : null}
            <dt>ডেলিভারি ফি</dt>
            <dd className="text-right">{taka(o.deliveryFeePoisha)}</dd>
            <dt className="font-bold">মোট</dt>
            <dd className="text-right font-bold">{taka(o.totalPoisha)}</dd>
          </dl>
          {o.payments.map((p) => (
            <p key={p.id} className="mt-2 text-sm">
              <PaymentBadge status={p.status} method={p.method} /> {taka(p.amountPoisha)}
              {p.refundedPoisha ? ` · ফেরত ${taka(p.refundedPoisha)}` : ''}
              {p.duplicateCapture ? (
                <>
                  {' '}
                  <Badge tone="bad">ডুপ্লিকেট পেমেন্ট</Badge>
                </>
              ) : null}
            </p>
          ))}
        </section>
      </div>

      <section className="card mt-4 p-4" aria-labelledby="h-timeline">
        <h2 id="h-timeline" className="mb-2 font-semibold">
          ইতিহাস
        </h2>
        <ol className="space-y-1 text-sm">
          {o.events.map((e) => (
            <li key={e.id}>
              <span className="font-latin text-muted">{dateTime(e.createdAt)}</span> · {e.fromStatus ? `${ORDER_STATUS[e.fromStatus]} → ` : ''}
              <strong>{ORDER_STATUS[e.toStatus]}</strong> <span className="text-xs text-muted">({e.actorRole})</span>
              {e.reason ? <span className="text-muted"> — {e.reason}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      <Modal open={target !== null} title={target ? TRANSITION_LABEL[target] ?? target : ''} onClose={() => setTarget(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void doTransition();
          }}
        >
          {target && NEEDS_REASON.has(target) ? (
            <Field label="কারণ (গ্রাহক এটি দেখতে পারেন)" id="t-reason">
              <textarea id="t-reason" className="field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
            </Field>
          ) : null}
          {needsReturned ? (
            <fieldset className="mb-3">
              <legend className="label">ফেরত আসা পণ্য</legend>
              <label className="mr-4 text-sm">
                <input type="radio" name="returned" checked={returned === 'RESTOCK'} onChange={() => setReturned('RESTOCK')} /> স্টকে ফেরত
              </label>
              <label className="text-sm">
                <input type="radio" name="returned" checked={returned === 'WRITE_OFF'} onChange={() => setReturned('WRITE_OFF')} /> নষ্ট — রাইট-অফ
              </label>
            </fieldset>
          ) : null}
          {target === 'CANCELLED' && o.paymentMethod === 'ONLINE' && o.paymentStatus === 'PAID' ? (
            <p className="mb-3 rounded-lg bg-[#fff4cc] p-2 text-sm text-warning">অনলাইন পেমেন্ট নেওয়া হয়েছে — বাতিল করলে সুপার অ্যাডমিনের জন্য একটি রিফান্ড অনুরোধ তৈরি হবে।</p>
          ) : null}
          <Msg error={act.error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setTarget(null)}>
              ফিরে যান
            </button>
            <button className="btn btn-danger" disabled={act.busy || (target !== null && NEEDS_REASON.has(target) && reason.trim().length < 3) || (needsReturned && !returned)}>
              নিশ্চিত করুন
            </button>
          </div>
        </form>
      </Modal>

      {showReschedule ? <Reschedule order={o} onClose={() => setShowReschedule(false)} onDone={reload} /> : null}
    </>
  );
}

function AssignRider({ order, onDone }: { order: OrderDetail; onDone: () => Promise<void> }) {
  const { data: riders, error } = useLoad<{ id: string; fullName: string | null; phone: string | null }[]>(`/admin/outlets/${order.outlet.id}/riders`);
  const [rider, setRider] = useState(order.delivery?.rider?.id ?? '');
  const a = useAction();
  return (
    <form
      className="mt-3 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(() => api(`/admin/orders/${order.id}/assign-rider`, { body: { riderUserId: rider } }), 'রাইডার নির্ধারণ হয়েছে').then((ok) => (ok ? onDone() : undefined));
      }}
    >
      <label className="text-sm">
        <span className="label">রাইডার</span>
        <select className="field field-sm min-w-48" value={rider} onChange={(e) => setRider(e.target.value)}>
          <option value="">— বেছে নিন —</option>
          {(riders ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {r.fullName ?? r.phone}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-ghost btn-sm" disabled={!rider || a.busy}>
        রাইডার নির্ধারণ
      </button>
      {riders && riders.length === 0 ? <span className="text-sm text-muted">এই আউটলেটে কোনো সক্রিয় রাইডার নেই — আউটলেট ও স্টাফ পাতায় যোগ করুন।</span> : null}
      <Msg error={a.error ?? error} ok={a.ok} />
    </form>
  );
}

function Reschedule({ order, onClose, onDone }: { order: OrderDetail; onClose: () => void; onDone: () => Promise<void> }) {
  const [date, setDate] = useState(dateTime(order.slotStartsAt).slice(0, 10));
  const { data: slots, error } = useLoad<Slot[]>(`/admin/outlets/${order.outlet.id}/slots?date=${date}`);
  const [chosen, setChosen] = useState('');
  const a = useAction();
  const now = Date.now();
  const usable = (slots ?? []).filter((x) => x.status === 'OPEN' && new Date(x.startsAt).getTime() > now && x.bookedCount < x.capacity);
  return (
    <Modal open title="স্লট পরিবর্তন" onClose={onClose}>
      <Field label="তারিখ" id="r-date">
        <input id="r-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {error ? <Msg error={error} /> : null}
      {slots && usable.length === 0 ? <p className="mb-3 text-sm text-muted">এই তারিখে খালি স্লট নেই।</p> : null}
      <fieldset className="mb-3 space-y-1">
        <legend className="sr-only">স্লট</legend>
        {usable.map((x) => (
          <label key={x.id} className="flex items-center gap-2 text-sm">
            <input type="radio" name="slot" value={x.id} checked={chosen === x.id} onChange={() => setChosen(x.id)} />
            <span className="font-latin">{slot(x.startsAt, x.endsAt)}</span>
            <span className="text-muted">
              ({x.capacity - x.bookedCount} খালি)
            </span>
          </label>
        ))}
      </fieldset>
      <Msg error={a.error} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          বাতিল
        </button>
        <button
          className="btn btn-primary"
          disabled={!chosen || a.busy}
          onClick={() =>
            void a.run(() => api(`/admin/orders/${order.id}/reschedule`, { body: { slotId: chosen } })).then(async (ok) => {
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
