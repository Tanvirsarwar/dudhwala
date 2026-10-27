'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { zoneEligibility, type DeliveryZone, type Eligibility, type EligibilityProduct } from '@dudhwala/shared';
import { DEMO_BRANDING } from '@/components/developer-credit';

/**
 * Delivery-zone state for the DEMO build. Persisted in localStorage under a clearly demo key.
 * The eligibility RULES live in @dudhwala/shared (ordering.ts); filtering here is a demo convenience, not enforcement:
 * the real backend must re-check every cart and order (docs/PHASE2_INTEGRATION.md).
 * Outside the demo build the zone is fixed to IN_CITY, so the production storefront behaves as before.
 */
export const ZONE_KEY = 'dw.demo.zone';
export const DEMO_ORDERING = DEMO_BRANDING;

interface ZoneCtx {
  zone: DeliveryZone;
  setZone: (z: DeliveryZone) => void;
}
const Ctx = createContext<ZoneCtx>({ zone: 'IN_CITY', setZone: () => undefined });

const read = (): DeliveryZone => {
  try {
    return window.localStorage.getItem(ZONE_KEY) === 'OUTER_CITY' ? 'OUTER_CITY' : 'IN_CITY';
  } catch {
    return 'IN_CITY';
  }
};

export function ZoneProvider({ children }: { children: React.ReactNode }) {
  const [zone, set] = useState<DeliveryZone>('IN_CITY');
  useEffect(() => {
    if (!DEMO_ORDERING) return;
    set(read());
    const on = () => set(read());
    window.addEventListener('dw:zone', on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener('dw:zone', on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const setZone = useCallback((z: DeliveryZone) => {
    try {
      window.localStorage.setItem(ZONE_KEY, z);
    } catch {
      /* storage blocked: the choice lasts until reload */
    }
    set(z);
    window.dispatchEvent(new Event('dw:zone'));
  }, []);
  const value = useMemo(() => ({ zone, setZone }), [zone, setZone]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useZone = () => useContext(Ctx);

/** Eligibility of a product for the current zone (always eligible outside the demo build). */
export function useEligibility() {
  const { zone } = useZone();
  return useCallback((p: EligibilityProduct): Eligibility => (DEMO_ORDERING ? zoneEligibility(p, zone) : { eligible: true, reason: 'in_city_all' }), [zone]);
}
