'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from './api';

export interface Me {
  user: { fullName: string; email: string };
  role: 'ADMIN' | 'MANAGER';
  /** false for managers: they can look at everything and change nothing (the API refuses writes as well) */
  canEdit: boolean;
}
interface SessionValue {
  me: Me;
  canEdit: boolean;
  isManager: boolean;
  logout: () => Promise<void>;
}
const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

const AREA_KEY = 'dw.staff.area';
/** Remembers which login page the user came from, so "log out" / "session expired" returns them to the right one. */
export const rememberArea = (role: 'ADMIN' | 'MANAGER') => {
  try {
    window.localStorage.setItem(AREA_KEY, role === 'MANAGER' ? 'manager' : 'admin');
  } catch {
    /* storage blocked: falls back to the admin login page */
  }
};
const loginPath = () => {
  try {
    return window.localStorage.getItem(AREA_KEY) === 'manager' ? '/manager/login' : '/login';
  } catch {
    return '/login';
  }
};

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api<Me>('/me')
      .then((m) => alive && setMe(m))
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) router.replace(loginPath());
        else setFailed(e instanceof Error ? e.message : 'Could not load your session');
      });
    const onUnauth = () => router.replace(loginPath());
    window.addEventListener('dw:unauthenticated', onUnauth);
    return () => {
      alive = false;
      window.removeEventListener('dw:unauthenticated', onUnauth);
    };
  }, [router]);

  const value = useMemo<SessionValue | null>(
    () =>
      me && {
        me,
        canEdit: me.canEdit,
        isManager: me.role === 'MANAGER',
        logout: async () => {
          const to = loginPath();
          await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
          window.location.href = to;
        },
      },
    [me],
  );

  if (failed)
    return (
      <div className="p-6" role="alert">
        <p className="font-semibold text-danger">সেশন লোড করা যায়নি।</p>
        <p className="text-sm text-muted">{failed}</p>
        <button className="btn btn-ghost mt-3" onClick={() => window.location.reload()}>
          আবার চেষ্টা করুন
        </button>
      </div>
    );
  if (!value) return <p className="p-6 text-muted">লোড হচ্ছে…</p>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
