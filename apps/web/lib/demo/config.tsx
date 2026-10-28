'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_ORDERING_CONFIG, hoursOf, type Hours, type OrderingConfig } from '@dudhwala/shared';
import { api } from '@/lib/api';
import { DEMO_BRANDING } from '@/components/developer-credit';

/** Ordering hours and bulk thresholds, edited by the admin (Settings) and served by GET /config. */
export interface RuntimeConfig extends OrderingConfig {
  hoursFull: Hours;
  /** true until the owner has saved real values: the UI then labels the bulk threshold as a placeholder */
  isPlaceholder: boolean;
  /** online payment (bulk orders): disabled until the owner activates a real provider; sandbox = fake money */
  payments: { enabled: boolean; sandbox: boolean };
}
const NO_PAYMENTS = { enabled: false, sandbox: false };
const make = (c: OrderingConfig, isPlaceholder: boolean, payments = NO_PAYMENTS): RuntimeConfig => ({ ...c, hoursFull: hoursOf(c), isPlaceholder, payments });
const Ctx = createContext<RuntimeConfig>(make(DEFAULT_ORDERING_CONFIG, true));

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [raw, setRaw] = useState<{ cfg: OrderingConfig; ph: boolean; pay: RuntimeConfig['payments'] }>({ cfg: DEFAULT_ORDERING_CONFIG, ph: true, pay: NO_PAYMENTS });
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ hours: OrderingConfig['hours']; bulk: OrderingConfig['bulk'] & { isPlaceholder?: boolean }; payments?: RuntimeConfig['payments'] }>('/config')
        .then((c) => alive && setRaw({ cfg: { hours: c.hours, bulk: { minTotalQuantity: c.bulk.minTotalQuantity, minTotalPoisha: c.bulk.minTotalPoisha } }, ph: c.bulk.isPlaceholder !== false, pay: c.payments ?? (DEMO_BRANDING ? { enabled: true, sandbox: true } : NO_PAYMENTS) }))
        .catch(() => undefined); // keep the defaults when the API has no /config
    void load();
    const t = setInterval(load, 60_000); // pick up admin changes without a reload
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const value = useMemo(() => make(raw.cfg, raw.ph, raw.pay), [raw]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useConfig = () => useContext(Ctx);
