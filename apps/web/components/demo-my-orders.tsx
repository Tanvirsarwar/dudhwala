'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { forgetOrder, orderService, readOrderRefs, type DemoOrder } from '@/lib/services';
import { DemoOrderCard } from './demo-order-card';

type Row = { id: string; order: DemoOrder | null; state: 'ok' | 'missing' | 'error' };

/** Demo "My orders": the orders placed from this browser (no customer login in the demo). Refreshes by itself. */
export function DemoMyOrders() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const load = useCallback(async () => {
    const refs = readOrderRefs();
    setRows(
      await Promise.all(
        refs.map(async (r): Promise<Row> => {
          try {
            const order = await orderService.get(r.id, r.token);
            return order ? { id: r.id, order, state: 'ok' } : { id: r.id, order: null, state: 'missing' };
          } catch {
            return { id: r.id, order: null, state: 'error' };
          }
        }),
      ),
    );
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    window.addEventListener('dw:my-orders', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('dw:my-orders', load);
    };
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <h1 className="text-2xl font-bold">আমার অর্ডার</h1>
      <p className="notice notice-info mt-2">
        <span>ডেমোতে লগইন নেই।</span> <span>এখানে শুধু এই ব্রাউজার থেকে দেওয়া অর্ডার দেখা যায়।</span>
      </p>
      {rows === null ? (
        <div className="mt-4 grid gap-3" aria-busy="true" aria-label="লোড হচ্ছে…">
          <div className="skeleton h-32 rounded-2xl" />
          <div className="skeleton h-32 rounded-2xl" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="text-muted">এখনো কোনো অর্ডার দেওয়া হয়নি।</p>
          <Link href="/" className="btn btn-primary mt-4">
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      ) : (
        <ul className="mt-4 grid gap-3">
          {rows.map((r) => (
            <li key={r.id}>
              {r.order ? (
                <>
                  <DemoOrderCard order={r.order} />
                  <Link href={`/orders/${r.id}`} className="btn btn-ghost btn-compact mt-2">
                    বিস্তারিত দেখুন
                  </Link>
                </>
              ) : (
                <div className="card flex flex-wrap items-center justify-between gap-3 p-4" role={r.state === 'error' ? 'alert' : undefined}>
                  <span>
                    <b className="font-latin">{r.id}</b> — {r.state === 'error' ? <span>অর্ডার লোড করা যায়নি। আবার চেষ্টা করুন।</span> : <span>এই অর্ডারটি আর পাওয়া যাচ্ছে না (ডেমো ডেটা রিসেট হতে পারে)।</span>}
                  </span>
                  <span className="flex gap-2">
                    {r.state === 'error' && (
                      <button type="button" className="btn btn-ghost btn-compact" onClick={() => void load()}>
                        আবার চেষ্টা করুন
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-compact" onClick={() => forgetOrder(r.id)}>
                      তালিকা থেকে সরান
                    </button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
