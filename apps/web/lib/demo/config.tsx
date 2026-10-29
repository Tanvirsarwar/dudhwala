'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ORDERING_CONFIG, hoursOf, NO_DELIVERY_FEES, type DeliveryFees, type Hours, type OrderingConfig } from '@dudhwala/shared';
import { api } from '@/lib/api';

/** Ordering hours and bulk thresholds, edited by the admin (Settings) and served by GET /config. */
export interface RuntimeConfig extends OrderingConfig {
  hoursFull: Hours;
  /** true until the owner has saved real values: the UI then labels the bulk threshold as a placeholder */
  isPlaceholder: boolean;
  /** home-delivery fee per zone in poisha (set in the admin Settings; 0 = free) */
  deliveryFees: DeliveryFees;
}
const make = (c: OrderingConfig, isPlaceholder: boolean, deliveryFees: DeliveryFees = NO_DELIVERY_FEES): RuntimeConfig => ({ ...c, hoursFull: hoursOf(c), isPlaceholder, deliveryFees });
const Ctx = createContext<RuntimeConfig>(make(DEFAULT_ORDERING_CONFIG, true));

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<{ cfg: OrderingConfig; ph: boolean; fees: DeliveryFees }>({ cfg: DEFAULT_ORDERING_CONFIG, ph: true, fees: NO_DELIVERY_FEES });
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ hours: OrderingConfig['hours']; bulk: OrderingConfig['bulk'] & { isPlaceholder?: boolean }; deliveryFees?: DeliveryFees }>('/config')
        .then((c) => alive && setRaw({ cfg: { hours: c.hours, bulk: { minTotalQuantity: c.bulk.minTotalQuantity, minTotalPoisha: c.bulk.minTotalPoisha } }, ph: c.bulk.isPlaceholder !== false, fees: c.deliveryFees ?? NO_DELIVERY_FEES }))
        .catch(() => undefined); // keep the defaults when the API has no /config
    void load();
    const t = setInterval(load, 60_000); // pick up admin changes without a reload
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const value = useMemo(() => make(raw.cfg, raw.ph, raw.fees), [raw]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useConfig = () => useContext(Ctx);
