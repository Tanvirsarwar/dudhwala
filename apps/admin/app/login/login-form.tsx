'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { rememberArea } from '@/lib/session';
import { useAction } from '@/lib/use-load';
import { Field, Msg } from '@/components/ui';
import { AuthCard } from './auth-card';

// Demo login hints come from the demo launcher's environment (start-demo.sh / .bat); production builds contain none.
const HINT_ADMIN = process.env.NEXT_PUBLIC_DEMO_ADMIN_LOGIN;
const HINT_MANAGER = process.env.NEXT_PUBLIC_DEMO_MANAGER_LOGIN;

/** One login form for both staff pages: the admin page signs in admins, the manager page signs in managers. */
export function LoginForm({ as }: { as: 'admin' | 'manager' }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const a = useAction();
  const manager = as === 'manager';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await a.run(async () => {
      await api('/auth/staff/login', { body: { login, password, as } });
    });
    if (!ok) return;
    rememberArea(manager ? 'MANAGER' : 'ADMIN');
    window.location.href = '/';
  }

  return (
    <AuthCard title={manager ? 'ম্যানেজার লগইন' : 'অ্যাডমিন লগইন'}>
      {manager && <p className="mb-3 rounded-xl bg-brand-100 p-3 text-sm text-brand-700">ম্যানেজার অ্যাকাউন্ট দিয়ে অর্ডার ও পণ্যের সংখ্যা দেখা যায়। কিছু পরিবর্তন করা যায় না।</p>}
      <form onSubmit={submit} noValidate>
        <Field label="ইমেইল বা মোবাইল" id="login">
          <input id="login" className="field" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Field>
        <Field label="পাসওয়ার্ড" id="password">
          <input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Msg error={a.error} />
        <button className="btn btn-primary w-full" disabled={a.busy || !login || !password} aria-busy={a.busy}>
          লগইন
        </button>
      </form>
      {(manager ? HINT_MANAGER : HINT_ADMIN) && (
        <p className="notice notice-warn mt-3 text-xs">
          <b>ডেমো লগইন:</b> <span className="font-latin">{manager ? HINT_MANAGER : HINT_ADMIN}</span>
        </p>
      )}
      <p className="mt-4 text-sm">
        {manager ? (
          <Link href="/login" className="text-link underline">
            অ্যাডমিন লগইন
          </Link>
        ) : (
          <Link href="/manager/login" className="text-link underline">
            ম্যানেজার লগইন
          </Link>
        )}
      </p>
    </AuthCard>
  );
}
