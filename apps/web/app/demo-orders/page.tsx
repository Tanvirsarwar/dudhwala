'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DemoOrderCard } from '@/components/demo-order-card';
import { DEMO_ORDERING } from '@/lib/demo/zone';
import { orderService, type DemoOrder } from '@/lib/services';

/** Demo orders saved in this browser only (localStorage "dw.demo.orders"). Not real orders. */
export default function DemoOrdersPage() {
  const [orders, setOrders] = useState<DemoOrder[] | null>(null);
  useEffect(() => {
    const load = () => setOrders(orderService.list());
    load();
    window.addEventListener('dw:demo-orders', load);
    return () => window.removeEventListener('dw:demo-orders', load);
  }, []);
  if (!DEMO_ORDERING) return <p className="pt-10 text-center text-muted">এই পাতাটি শুধু ডেমো সংস্করণে আছে।</p>;
  return (
    <div className="mx-auto max-w-3xl pt-6">
      <h1 className="text-2xl font-bold">ডেমো অর্ডার</h1>
      <p className="notice notice-info mt-2">
        <span>এগুলো আসল অর্ডার নয়।</span> <span>ডেমো অর্ডার শুধু এই ব্রাউজারে সংরক্ষিত থাকে।</span>
      </p>
      {orders === null ? (
        <p className="pt-6 text-muted">লোড হচ্ছে…</p>
      ) : orders.length === 0 ? (
        <div className="card mt-4 p-8 text-center">
          <p className="text-muted">এখনো কোনো ডেমো অর্ডার নেই।</p>
          <Link href="/" className="btn btn-primary mt-4">
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      ) : (
        <>
          <ul className="mt-4 grid gap-3">
            {orders.map((o) => (
              <li key={o.id}>
                <DemoOrderCard order={o} onAdvance={(id) => orderService.advance(id)} />
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-ghost btn-compact mt-4" onClick={() => orderService.clear()}>
            সব ডেমো অর্ডার মুছুন
          </button>
        </>
      )}
    </div>
  );
}
