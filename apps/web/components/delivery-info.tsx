'use client';

import { zoneEligibility, type OuterCityStatus } from '@dudhwala/shared';
import { DEMO_ORDERING } from '@/lib/demo/zone';
import { REASON_MESSAGES } from '@/lib/demo/messages';
import { ETA_TEXT } from './zone-bar';

/** Product page: delivery promise per zone. Pickup/collection options are shown at checkout, never as delivery. */
export function DeliveryInfo({ categorySlug, outerCityStatus }: { categorySlug: string; outerCityStatus?: OuterCityStatus | null }) {
  if (!DEMO_ORDERING) return null;
  const outer = zoneEligibility({ categorySlug, outerCityStatus }, 'OUTER_CITY');
  return (
    <ul className="mt-3 grid gap-1.5 text-sm" aria-label="ডেলিভারি জোন">
      <li className="notice notice-info">
        <b>ইন সিটি:</b> <span>{ETA_TEXT.IN_CITY}</span>
      </li>
      <li className={`notice ${outer.eligible ? 'notice-info' : 'notice-warn'}`}>
        <b>আউটার সিটি:</b> <span>{outer.eligible ? ETA_TEXT.OUTER_CITY : REASON_MESSAGES[outer.reason]}</span>
      </li>
    </ul>
  );
}
