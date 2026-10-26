'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, cartChanged } from '@/lib/api';
import { bnDigits, ORDER_STATUS_BN, PAYMENT_STATUS_BN, slotLabel, taka } from '@/lib/format';
import { OtpLogin } from '@/components/otp-login';

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: 'COD' | 'ONLINE';
  subtotalPoisha: number;
  discountPoisha: number;
  deliveryFeePoisha: number;
  totalPoisha: number;
  slotStartsAt: string;
  slotEndsAt: string;
  address: { name: string; phone: string; line1: string; line2: string | null; landmark: string | null; area: string; instructions: string | null };
  items: { productNameBn: string; variantLabelBn: string; unitPricePoisha: number; quantity: number; lineTotalPoisha: number }[];
  timeline: { toStatus: string; createdAt: string }[];
  cancellable: boolean;
}

const STEPS = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function OrderInner() {
  const { id } = useParams<{ id: string }>();
  const placed = useSearchParams().get('placed') === '1';
  const [o, setO] = useState<OrderDetail | null>(null);
  const [needLogin, setNeedLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(() => {
    api<OrderDetail>(`/me/orders/${id}`)
      .then((x) => {
        setO(x);
        setNeedLogin(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setNeedLogin(true);
        else setError('অর্ডারটি পাওয়া যায়নি');
      });
  }, [id]);
  useEffect(load, [load]);

  const cancel = async () => {
    try {
      await api(`/me/orders/${id}/cancel`, { method: 'POST', body: { reason } });
      dialog.current?.close();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'বাতিল করা যায়নি');
    }
  };
  const reorder = async () => {
    const r = await api<{ skipped: string[] }>(`/me/orders/${id}/reorder`, { method: 'POST' });
    cartChanged();
    window.location.assign(r.skipped.length ? '/cart?reorder=partial' : '/cart');
  };

  if (needLogin) return <div className="mx-auto max-w-md pt-8"><OtpLogin title="অর্ডার দেখতে প্রবেশ করুন" onDone={load} /></div>;
  if (error && !o) return <p className="pt-10 text-center">{error}</p>;
  if (!o) return <p className="pt-10 text-center text-muted">লোড হচ্ছে…</p>;

  const reached = new Set(o.timeline.map((t) => t.toStatus));
  const closed = ['CANCELLED', 'REJECTED', 'EXPIRED', 'DELIVERY_FAILED'].includes(o.status);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 pt-6">
      {placed && (
        <div className="rounded-2xl bg-accent-100 p-4 text-brand-700" role="status">
          <strong>ধন্যবাদ! আপনার অর্ডার গ্রহণ করা হয়েছে।</strong> SMS-এ আপডেট পাবেন।
        </div>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold">অর্ডার {o.orderNumber}</h1>
        <span className="rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700">{ORDER_STATUS_BN[o.status] ?? o.status}</span>
      </div>

      <section className="card p-5" aria-labelledby="t-title">
        <h2 id="t-title" className="sr-only">
          অবস্থা
        </h2>
        {closed ? (
          <p className="font-semibold text-danger">{ORDER_STATUS_BN[o.status]}</p>
        ) : (
          <ol className="relative grid gap-4 border-l-2 border-line pl-5">
            {STEPS.map((s) => {
              const done = reached.has(s);
              return (
                <li key={s} className="relative">
                  <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ${done ? 'bg-accent-500 ring-4 ring-accent-100' : 'bg-line'}`} aria-hidden />
                  <span className={done ? 'font-semibold' : 'text-muted'}>{ORDER_STATUS_BN[s]}</span>
                  {done && <span className="sr-only"> (সম্পন্ন)</span>}
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-4 text-sm">ডেলিভারি সময়: {slotLabel(o.slotStartsAt, o.slotEndsAt)}</p>
        <p className="text-sm">
          পেমেন্ট: {o.paymentMethod === 'COD' ? 'ক্যাশ অন ডেলিভারি' : 'অনলাইন'} — {PAYMENT_STATUS_BN[o.paymentStatus] ?? o.paymentStatus}
        </p>
      </section>

      <section className="card p-5">
        <h2 className="mb-2 font-bold">পণ্য</h2>
        <ul className="grid gap-1">
          {o.items.map((i, k) => (
            <li key={k} className="flex justify-between gap-2">
              <span>
                {i.productNameBn} ({i.variantLabelBn}) × {bnDigits(i.quantity)}
              </span>
              <span>{taka(i.lineTotalPoisha)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt>সাবটোটাল</dt>
            <dd>{taka(o.subtotalPoisha)}</dd>
          </div>
          {o.discountPoisha > 0 && (
            <div className="flex justify-between">
              <dt>ছাড়</dt>
              <dd>−{taka(o.discountPoisha)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>ডেলিভারি</dt>
            <dd>{taka(o.deliveryFeePoisha)}</dd>
          </div>
          <div className="flex justify-between text-base font-bold">
            <dt>মোট</dt>
            <dd>{taka(o.totalPoisha)}</dd>
          </div>
        </dl>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="mb-2 font-bold">ঠিকানা</h2>
        <p>
          {o.address.name}, {o.address.phone}
          <br />
          {o.address.line1}
          {o.address.line2 ? `, ${o.address.line2}` : ''}, {o.address.area}
          {o.address.landmark && <><br />{o.address.landmark}</>}
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        {o.status === 'PENDING_PAYMENT' && (
          <Link href={`/checkout/return?order=${o.id}`} className="btn btn-primary">
            পেমেন্ট সম্পন্ন করুন
          </Link>
        )}
        {o.cancellable && (
          <button className="btn btn-ghost text-danger" onClick={() => dialog.current?.showModal()}>
            অর্ডার বাতিল
          </button>
        )}
        <button className="btn btn-ghost" onClick={() => void reorder()}>
          আবার অর্ডার করুন
        </button>
        <Link href="/account" className="btn btn-ghost">
          সব অর্ডার
        </Link>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}

      <dialog ref={dialog} aria-labelledby="c-title" className="m-auto w-[min(92vw,420px)] rounded-2xl p-5 backdrop:bg-black/40">
        <h2 id="c-title" className="text-lg font-bold">
          অর্ডার বাতিল করবেন?
        </h2>
        <label htmlFor="c-reason" className="label mt-3">
          কারণ
        </label>
        <input id="c-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="mt-4 flex gap-2">
          <button className="btn btn-primary bg-danger" disabled={reason.trim().length < 3} onClick={() => void cancel()}>
            বাতিল নিশ্চিত করুন
          </button>
          <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
            ফিরে যান
          </button>
        </div>
      </dialog>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<p className="pt-10 text-center">লোড হচ্ছে…</p>}>
      <OrderInner />
    </Suspense>
  );
}
