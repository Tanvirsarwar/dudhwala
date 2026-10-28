'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { orderService, tokenFor, type DemoOrder } from '@/lib/services';
import { DemoOrderCard } from './demo-order-card';

/** Demo order page (/orders/DEMO-n): only the browser that placed the order can open it (private token). */
export function DemoOrderDetail({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: 'loading' } | { kind: 'ok'; order: DemoOrder } | { kind: 'missing' } | { kind: 'error' }>({ kind: 'loading' });
  const load = useCallback(async () => {
    const token = tokenFor(id);
    if (!token) return setState({ kind: 'missing' });
    try {
      const order = await orderService.get(id, token);
      setState(order ? { kind: 'ok', order } : { kind: 'missing' });
    } catch {
      setState((s) => (s.kind === 'ok' ? s : { kind: 'error' })); // keep showing the last good copy on a refresh failure
    }
  }, [id]);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <Link href="/account" className="text-sm text-link underline">
        ← আমার অর্ডার
      </Link>
      <div className="mt-3">
        {state.kind === 'loading' && <div className="skeleton h-40 rounded-2xl" aria-busy="true" aria-label="লোড হচ্ছে…" />}
        {state.kind === 'ok' && <DemoOrderCard order={state.order} />}
        {state.kind === 'missing' && (
          <div className="card p-8 text-center">
            <p className="font-semibold">অর্ডারটি পাওয়া যায়নি</p>
            <p className="mt-1 text-sm text-muted">অর্ডারটি এই ব্রাউজার থেকে দেওয়া হয়নি, অথবা ডেমো ডেটা রিসেট হয়েছে।</p>
            <Link href="/account" className="btn btn-primary mt-4">
              আমার অর্ডার
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <div className="notice notice-err" role="alert">
            <p>অর্ডার লোড করা যায়নি।</p>
            <button type="button" className="btn btn-ghost btn-compact mt-2" onClick={() => void load()}>
              আবার চেষ্টা করুন
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
