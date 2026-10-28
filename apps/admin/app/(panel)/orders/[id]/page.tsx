'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import type { DemoOrderStatus, FulfilmentMethod } from '@dudhwala/shared';
import { api } from '@/lib/api';
import { METHOD_BN, ORDER_STATUS_BN, PAYMENT_BN, dateTime, taka } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { Loading, Msg, OrderBadge, PageTitle } from '@/components/ui';

interface Order {
  id: string;
  createdAt: string;
  method: FulfilmentMethod;
  zone: string | null;
  status: DemoOrderStatus;
  totalPoisha: number | null;
  payment: string;
  address?: { name: string; phone: string; line1: string; landmark: string };
  contact?: { name: string; phone: string };
  outlet?: { nameBn: string };
  pickupAt?: string;
  lines: { key: string; productSlug: string; nameBn: string; quantity: number; unitPricePoisha: number | null; linePoisha: number | null }[];
  history: { status: DemoOrderStatus; at: string; by: string }[];
  flow: DemoOrderStatus[];
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canEdit } = useSession();
  const { data: o, error, setData } = useLoad<Order>(`/admin/orders/${encodeURIComponent(id)}`);
  const act = useAction();
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (!o) return <Loading error={error} />;

  const idx = o.flow.indexOf(o.status);
  const finished = o.status === 'DEMO_CANCELLED' || idx === o.flow.length - 1;
  const next = finished ? null : o.flow[idx + 1];
  const move = (status: DemoOrderStatus) => act.run(async () => setData(await api<Order>(`/admin/orders/${encodeURIComponent(o.id)}`, { method: 'PATCH', body: { status } })), 'অবস্থা বদলানো হয়েছে');
  const who = o.address ?? o.contact;

  return (
    <>
      <PageTitle title={o.id}>
        <Link href="/orders" className="btn btn-ghost btn-sm">
          ← সব অর্ডার
        </Link>
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <section className="card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <OrderBadge status={o.status} />
              <span className="font-semibold">{METHOD_BN[o.method]}</span>
              <span className="font-latin text-sm text-muted">{dateTime(o.createdAt)}</span>
            </div>
            <dl className="mt-3 grid gap-1 text-sm">
              {who && (
                <div>
                  <dt className="inline font-semibold">গ্রাহক: </dt>
                  <dd className="inline">
                    {who.name} · <span className="font-latin">{who.phone}</span>
                  </dd>
                </div>
              )}
              {o.address && (
                <div>
                  <dt className="inline font-semibold">ঠিকানা: </dt>
                  <dd className="inline">
                    {o.address.line1}
                    {o.address.landmark ? ` (${o.address.landmark})` : ''}
                  </dd>
                </div>
              )}
              {o.zone && (
                <div>
                  <dt className="inline font-semibold">জোন: </dt>
                  <dd className="inline">{o.zone === 'IN_CITY' ? 'ইন সিটি' : 'আউটার সিটি'}</dd>
                </div>
              )}
              {o.outlet && (
                <div>
                  <dt className="inline font-semibold">{o.method === 'BULK_ORDER' ? 'সংগ্রহের স্থান: ' : 'পিকআপ আউটলেট: '}</dt>
                  <dd className="inline">{o.outlet.nameBn}</dd>
                </div>
              )}
              {o.pickupAt && (
                <div>
                  <dt className="inline font-semibold">পিকআপের সময়: </dt>
                  <dd className="inline font-latin">{dateTime(o.pickupAt)}</dd>
                </div>
              )}
              <div>
                <dt className="inline font-semibold">পেমেন্ট: </dt>
                <dd className="inline">{PAYMENT_BN[o.payment] ?? o.payment}</dd>
              </div>
            </dl>
          </section>
          <section className="card overflow-x-auto p-4" aria-labelledby="ol">
            <h2 id="ol" className="mb-2 font-semibold">
              পণ্য
            </h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>পণ্য</th>
                  <th>সংখ্যা</th>
                  <th>একক দাম</th>
                  <th>মোট</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.key}>
                    <td>{l.nameBn}</td>
                    <td>{l.quantity}</td>
                    <td>{taka(l.unitPricePoisha)}</td>
                    <td>{taka(l.linePoisha)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="text-right font-semibold">
                    মোট
                  </td>
                  <td className="font-bold">{taka(o.totalPoisha)}</td>
                </tr>
              </tfoot>
            </table>
            {o.totalPoisha === null && <p className="mt-2 text-sm text-warning">কিছু পণ্যের দাম তখন দেওয়া ছিল না, তাই মোট হিসাব করা যায়নি।</p>}
          </section>
        </div>
        <aside className="grid content-start gap-4">
          <section className="card p-4" aria-labelledby="st">
            <h2 id="st" className="mb-2 font-semibold">
              অবস্থা পরিবর্তন
            </h2>
            {!canEdit ? (
              <p className="text-sm text-muted">ম্যানেজার অ্যাকাউন্টে শুধু দেখা যায়।</p>
            ) : finished ? (
              <p className="text-sm text-muted">এই অর্ডার শেষ হয়েছে।</p>
            ) : (
              <div className="grid gap-2">
                {next && (
                  <button type="button" className="btn btn-primary" disabled={act.busy} aria-busy={act.busy} onClick={() => void move(next)}>
                    {ORDER_STATUS_BN[next]}
                  </button>
                )}
                {!confirmCancel ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(true)}>
                    অর্ডার বাতিল করুন
                  </button>
                ) : (
                  <div className="rounded-xl bg-danger-bg p-3 text-sm">
                    <p className="mb-2 font-semibold text-danger">অর্ডারটি বাতিল করবেন? এটি ফেরানো যাবে না।</p>
                    <div className="flex gap-2">
                      <button type="button" className="btn btn-danger btn-sm" disabled={act.busy} onClick={() => void move('DEMO_CANCELLED').then(() => setConfirmCancel(false))}>
                        হ্যাঁ, বাতিল করুন
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmCancel(false)}>
                        না
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <Msg error={act.error} ok={act.ok} />
            {o.method === 'EXPRESS_PICKUP' && <p className="mt-2 text-xs text-muted">"পিকআপ নিশ্চিত — অর্ডার প্রস্তুত" দিলে তবেই গ্রাহক পিকআপ নিশ্চিত দেখবেন।</p>}
          </section>
          <section className="card p-4" aria-labelledby="hi">
            <h2 id="hi" className="mb-2 font-semibold">
              ইতিহাস
            </h2>
            <ol className="grid gap-1 text-sm">
              {[...o.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className="font-latin text-muted">{dateTime(h.at)}</span> · {ORDER_STATUS_BN[h.status]}
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </>
  );
}
