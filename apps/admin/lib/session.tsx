'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MFA_REQUIRED_ROLES, type Permission, type StaffRole } from '@dudhwala/shared';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; fullName: string | null; email: string | null; phone: string | null; mfaEnabled: boolean };
  role: StaffRole;
  outletId: string | null;
  mfaVerified: boolean;
  permissions: Permission[];
}

export interface OutletLite {
  id: string;
  code: string;
  nameBn: string;
  status: string;
}

interface SessionValue {
  me: Me;
  can: (p: Permission) => boolean;
  isSuper: boolean;
  outlets: OutletLite[];
  /** The outlet the screens act on: fixed for outlet staff; chosen by a Super Admin (null = all outlets). */
  outletId: string | null;
  setOutletId: (id: string | null) => void;
  reloadOutlets: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

const OUTLET_KEY = 'dw.admin.outlet';
const readStored = () => {
  try {
    return window.localStorage.getItem(OUTLET_KEY);
  } catch {
    return null;
  }
};
const writeStored = (id: string | null) => {
  try {
    if (id) window.localStorage.setItem(OUTLET_KEY, id);
    else window.localStorage.removeItem(OUTLET_KEY);
  } catch {
    /* storage unavailable: selection lasts for this page view */
  }
};

/** Loads the staff session; sends the user to login / two-factor / rider app as needed. */
export function SessionProvider({ children, area }: { children: React.ReactNode; area: 'admin' | 'rider' }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [outlets, setOutlets] = useState<OutletLite[]>([]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const loadOutlets = useCallback(async () => {
    setOutlets(await api<OutletLite[]>('/admin/outlets'));
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const m = await api<Me & { role: string }>('/me');
        if (!alive) return;
        if ((m.role as string) === 'CUSTOMER') return router.replace('/login');
        const needsMfa = MFA_REQUIRED_ROLES.has(m.role) && !m.mfaVerified;
        if (needsMfa) return router.replace(m.user.mfaEnabled ? '/login/mfa' : '/login/enroll');
        if (m.role === 'DELIVERY_STAFF' && area !== 'rider') return router.replace('/rider');
        if (m.role !== 'DELIVERY_STAFF' && area === 'rider') return router.replace('/');
        setMe(m);
        if (m.role === 'SUPER_ADMIN') setChosen(readStored());
        if (m.role !== 'DELIVERY_STAFF') await loadOutlets();
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        else setFailed(e instanceof Error ? e.message : 'Could not load your session');
      }
    })();
    const onUnauth = () => router.replace('/login');
    window.addEventListener('dw:unauthenticated', onUnauth);
    return () => {
      alive = false;
      window.removeEventListener('dw:unauthenticated', onUnauth);
    };
  }, []);

  const value = useMemo<SessionValue | null>(() => {
    if (!me) return null;
    const perms = new Set(me.permissions);
    const isSuper = me.role === 'SUPER_ADMIN';
    const valid = chosen && outlets.some((o) => o.id === chosen) ? chosen : null;
    return {
      me,
      can: (p) => perms.has(p),
      isSuper,
      outlets,
      outletId: isSuper ? valid : me.outletId,
      setOutletId: (id) => {
        setChosen(id);
        writeStored(id);
      },
      reloadOutlets: loadOutlets,
      logout: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.href = '/login';
      },
    };
  }, [me, chosen, outlets, loadOutlets]);

  if (failed) {
    return (
      <div className="p-6" role="alert">
        <p className="font-semibold text-danger">সেশন লোড করা যায়নি।</p>
        <p className="text-sm text-muted">{failed}</p>
        <button className="btn btn-ghost mt-3" onClick={() => window.location.reload()}>
          আবার চেষ্টা করুন
        </button>
      </div>
    );
  }
  if (!value) return <p className="p-6 text-muted">লোড হচ্ছে…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
