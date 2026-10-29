'use client';

import { useEffect, useState } from 'react';
import { METHOD_BN, ORDER_STATUS_BN } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Empty, Loading, PageTitle, StaleNotice } from '@/components/ui';
import { OrdersTable, type OrderRow } from '@/components/orders-table';

export default function OrdersPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(status ? { status } : {}), ...(method ? { method } : {}) }).toString();
  const { data, error, reload } = useLoad<{ data: OrderRow[]; total: number }>(`/admin/orders${qs ? `?${qs}` : ''}`);
  useEffect(() => {
    const t = setInterval(() => void reload(), 15_000);
    return () => clearInterval(t);
  }, [reload]);

  return (
    <>
      <PageTitle title="অর্ডার" />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="oq">
            খুঁজুন (অর্ডার নম্বর, নাম, মোবাইল)
          </label>
          <input id="oq" className="field field-sm w-64" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="om">
            ধরন
          </label>
          <select id="om" className="field field-sm w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="">সব</option>
            {Object.entries(METHOD_BN).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="os">
            অবস্থা
          </label>
          <select id="os" className="field field-sm w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">সব</option>
            {Object.entries(ORDER_STATUS_BN).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
      </div>
      <StaleNotice error={data ? error : null} onRetry={() => void reload()} />
      {!data ? <Loading error={error} /> : data.data.length === 0 ? <Empty>কোনো অর্ডার পাওয়া যায়নি।</Empty> : <OrdersTable rows={data.data} />}
    </>
  );
}
