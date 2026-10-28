'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { orderingStatus, zoneEligibility, zonedParts, type DeliveryZone } from '@dudhwala/shared';
import { bnDigits, timeLabel } from '@/lib/format';
import { DEMO_ORDERING, useZone } from '@/lib/demo/zone';
import { useConfig } from '@/lib/demo/config';
import { useCart } from './header-client';

export const ETA_TEXT: Record<DeliveryZone, string> = {
  IN_CITY: '২৪ ঘণ্টার মধ্যে ডেলিভারি',
  OUTER_CITY: '১-২ দিনের মধ্যে ডেলিভারি',
};

/** Real runtime clock; re-read every 15 s so the open/closed chip never goes stale. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function OrderingChip({ now }: { now: Date | null }) {
  const { hoursFull } = useConfig();
  if (!now) return null;
  const s = orderingStatus(now, hoursFull);
  if (s.open && s.closesAt) {
    return (
      <span className="zone-chip zone-chip-open" role="status">
        <span>অর্ডার নেওয়া হচ্ছে</span>
        <span>{`${timeLabel(s.closesAt)} পর্যন্ত`}</span>
      </span>
    );
  }
  const tomorrow = s.reopensAt ? zonedParts(s.reopensAt).d !== zonedParts(now).d : false;
  return (
    <span className="zone-chip zone-chip-closed" role="status">
      <span>অর্ডার এখন বন্ধ</span>
      <span>আবার খুলবে:</span>
      {tomorrow && <span>আগামীকাল</span>}
      <span>{s.reopensAt ? timeLabel(s.reopensAt) : ''}</span>
    </span>
  );
}

/** Demo header strip: delivery-zone selector, delivery promise, ordering hours and cart warning. */
export function ZoneBar() {
  const { zone, setZone } = useZone();
  const { cart } = useCart();
  const now = useNow();
  if (!DEMO_ORDERING) return null;
  const blocked = zone === 'OUTER_CITY' ? (cart?.lines ?? []).filter((l) => !zoneEligibility({ categorySlug: l.categorySlug ?? '', outerCityStatus: l.outerCityStatus }, zone).eligible).length : 0;
  const seg = (z: DeliveryZone, label: string) => (
    <button type="button" className={`seg ${zone === z ? 'is-active' : ''}`} aria-pressed={zone === z} onClick={() => setZone(z)}>
      {label}
    </button>
  );
  return (
    <div className="zone-bar">
      <div className="page-w flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5 text-sm">
        <span className="font-semibold">ডেলিভারি জোন:</span>
        <div role="group" aria-label="ডেলিভারি জোন" className="seg-group on-bar">
          {seg('IN_CITY', 'ইন সিটি')}
          {seg('OUTER_CITY', 'আউটার সিটি')}
        </div>
        <span>{ETA_TEXT[zone]}</span>
        <OrderingChip now={now} />
        {blocked > 0 && (
          <Link href="/cart" className="zone-chip zone-chip-warn" role="alert">
            <b>{bnDigits(blocked)}</b>
            <span>টি পণ্য আউটার সিটিতে ডেলিভারি হবে না — কার্ট দেখুন</span>
          </Link>
        )}
        <Link href="/bulk" className="ml-auto inline-flex min-h-9 items-center font-semibold underline decoration-accent-500 underline-offset-4">
          বাল্ক অর্ডার
        </Link>
      </div>
    </div>
  );
}
