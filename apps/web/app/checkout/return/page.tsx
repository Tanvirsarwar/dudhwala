'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface PayStatus {
  status: string;
  paymentStatus: string;
  orderNumber: string;
  paymentExpiresAt: string | null;
}

/**
 * Payment return page. The URL says nothing trustworthy (API_SPECIFICATION §5):
 * we only show what the server reports after verifying with the gateway.
 */
function ReturnInner() {
  const params = useSearchParams();
  const orderId = params.get('order') ?? '';
  const valid = /^[0-9a-f-]{36}$/.test(orderId);
  const [st, setSt] = useState<PayStatus | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!valid) return;
    let stop = false;
    const started = Date.now();
    const tick = async () => {
      try {
        const s = await api<PayStatus>(`/orders/${orderId}/payment-status`);
        if (stop) return;
        setSt(s);
        const settled = s.paymentStatus === 'PAID' || s.status !== 'PENDING_PAYMENT' || s.paymentStatus === 'FAILED' || s.paymentStatus === 'CANCELLED';
        if (settled) return;
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          setError('অর্ডারটি দেখতে আপনার মোবাইল নম্বর দিয়ে প্রবেশ করুন।');
          return;
        }
      }
      if (Date.now() - started > 60_000) {
        setTimedOut(true);
        return;
      }
      setTimeout(() => void tick(), 2000);
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [orderId, valid]);

  const retry = async () => {
    try {
      const r = await api<{ redirectUrl: string }>(`/payments/${orderId}/initiate`, { method: 'POST' });
      window.location.assign(r.redirectUrl);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'আবার চেষ্টা করা যায়নি');
    }
  };
  const toCod = async () => {
    try {
      await api(`/payments/${orderId}/switch-to-cod`, { method: 'POST' });
      window.location.assign(`/orders/${orderId}?placed=1`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'পরিবর্তন করা যায়নি');
    }
  };

  if (!valid) return <p className="pt-10 text-center">লিংকটি সঠিক নয়।</p>;
  const paid = st?.paymentStatus === 'PAID';
  const failed = st && (st.paymentStatus === 'FAILED' || st.paymentStatus === 'CANCELLED') && st.status === 'PENDING_PAYMENT';

  return (
    <div className="card mx-auto mt-8 max-w-md p-6 text-center" aria-live="polite">
      {error && <p className="rounded-lg bg-danger-bg p-3 text-danger">{error}</p>}
      {!error && !st && <p>পেমেন্ট যাচাই করা হচ্ছে…</p>}
      {st && paid && (
        <>
          <h1 className="text-2xl font-bold text-success">পেমেন্ট সম্পন্ন হয়েছে</h1>
          <p className="mt-2">অর্ডার নম্বর: {st.orderNumber}</p>
          <Link href={`/orders/${orderId}`} className="btn btn-primary mt-4">
            অর্ডার দেখুন
          </Link>
        </>
      )}
      {st && !paid && st.status === 'PENDING_PAYMENT' && !failed && !timedOut && <p>পেমেন্ট যাচাই করা হচ্ছে… এই পাতাটি বন্ধ করবেন না।</p>}
      {st && !paid && timedOut && st.status === 'PENDING_PAYMENT' && !failed && (
        <p>পেমেন্টের নিশ্চিতকরণ এখনো আসেনি। নিশ্চিত হলে আমরা SMS পাঠাব — আবার পেমেন্ট করবেন না।</p>
      )}
      {failed && (
        <>
          <h1 className="text-xl font-bold text-danger">পেমেন্ট সম্পন্ন হয়নি</h1>
          <p className="mt-2 text-sm text-muted">আপনার অর্ডার কিছুক্ষণ সংরক্ষিত থাকবে।</p>
          <div className="mt-4 grid gap-2">
            <button className="btn btn-primary" onClick={() => void retry()}>
              আবার পেমেন্ট করুন
            </button>
            <button className="btn btn-ghost" onClick={() => void toCod()}>
              ক্যাশ অন ডেলিভারিতে নিন
            </button>
          </div>
        </>
      )}
      {st && st.status === 'EXPIRED' && <p className="mt-2 text-danger">পেমেন্টের সময় শেষ হয়ে গেছে। আবার অর্ডার করুন।</p>}
      {st && !paid && st.status !== 'PENDING_PAYMENT' && st.status !== 'EXPIRED' && (
        <Link href={`/orders/${orderId}`} className="btn btn-primary mt-4">
          অর্ডার দেখুন
        </Link>
      )}
    </div>
  );
}

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<p className="pt-10 text-center">লোড হচ্ছে…</p>}>
      <ReturnInner />
    </Suspense>
  );
}
