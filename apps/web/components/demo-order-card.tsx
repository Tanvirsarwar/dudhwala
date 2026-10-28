'use client';

import { dayLabel, taka, timeLabel, bnDigits } from '@/lib/format';
import { METHOD_LABEL, PAYMENT_LABEL, STATUS_LABEL } from '@/lib/demo/messages';
import type { DemoOrder } from '@/lib/services';
import { ETA_TEXT } from './zone-bar';

/** One demo order. Everything here is labelled demo; pickup and collection are never described as delivery. */
export function DemoOrderCard({ order }: { order: DemoOrder }) {
  return (
    <article className="card p-4" aria-label={order.id}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-latin text-lg font-bold">{order.id}</h3>
        <span className="rounded-full bg-accent-100 px-2.5 py-0.5 text-xs font-bold text-brand-700">ডেমো</span>
        <span className="text-sm font-semibold">{METHOD_LABEL[order.method]}</span>
      </header>
      <p className="mt-1 font-semibold text-brand-700" role="status">
        {STATUS_LABEL[order.status]}
      </p>
      <dl className="mt-2 grid gap-1 text-sm">
        {order.method === 'HOME_DELIVERY' && order.etaZone && (
          <div>
            <dt className="inline font-semibold">আনুমানিক ডেলিভারি: </dt>
            <dd className="inline">{ETA_TEXT[order.etaZone]}</dd>
          </div>
        )}
        {order.method === 'HOME_DELIVERY' && order.address && (
          <div>
            <dt className="inline font-semibold">ঠিকানা: </dt>
            <dd className="inline">{order.address.line1}</dd>
          </div>
        )}
        {order.method === 'EXPRESS_PICKUP' && order.outlet && (
          <div>
            <dt className="inline font-semibold">পিকআপ আউটলেট: </dt>
            <dd className="inline">{order.outlet.nameBn}</dd>
          </div>
        )}
        {order.method === 'EXPRESS_PICKUP' && order.pickupAt && (
          <div>
            <dt className="inline font-semibold">পিকআপের সময়: </dt>
            <dd className="inline">
              <span>{dayLabel(order.pickupAt)}</span> <span>{timeLabel(order.pickupAt)}</span>
            </dd>
          </div>
        )}
        {order.method === 'BULK_ORDER' && order.outlet && (
          <div>
            <dt className="inline font-semibold">সংগ্রহের স্থান: </dt>
            <dd className="inline">{order.outlet.nameBn}</dd>
          </div>
        )}
        <div>
          <dt className="inline font-semibold">পেমেন্ট: </dt>
          <dd className="inline">{PAYMENT_LABEL[order.payment]}</dd>
        </div>
      </dl>
      <ul className="mt-2 grid gap-0.5 text-sm">
        {order.lines.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span>
              {l.nameBn} × {bnDigits(l.quantity)}
            </span>
            <span className={l.linePoisha === null ? 'price-pending' : ''}>{taka(l.linePoisha)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex justify-between border-t border-line pt-2 font-bold">
        <span>মোট</span>
        <span className={order.totalPoisha === null ? 'price-pending' : ''}>{taka(order.totalPoisha)}</span>
      </p>
    </article>
  );
}
