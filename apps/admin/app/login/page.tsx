'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { Field, Msg } from '@/components/ui';
import { AuthCard } from './auth-card';

/** Staff login (email or phone + password). Two-factor follows for managers and Super Admins. */
export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const a = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    let r: { mfaRequired: boolean; mfaEnrolled: boolean } | undefined;
    const ok = await a.run(async () => {
      r = await api('/auth/staff/login', { body: { login, password } });
    });
    if (!ok || !r) return;
    const next = new URLSearchParams(window.location.search).get('next');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
    if (r.mfaRequired) window.location.href = r.mfaEnrolled ? `/login/mfa?next=${encodeURIComponent(safeNext)}` : '/login/enroll';
    else window.location.href = safeNext;
  }

  return (
    <AuthCard title="স্টাফ লগইন">
      <form onSubmit={submit} noValidate>
        <Field label="ইমেইল বা মোবাইল" id="login">
          <input id="login" className="field" autoComplete="username" value={login} onChange={(e) => setLogin(e.target.value)} required />
        </Field>
        <Field label="পাসওয়ার্ড" id="password">
          <input id="password" type="password" className="field" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Msg error={a.error} />
        <button className="btn btn-primary w-full" disabled={a.busy || !login || !password}>
          {a.busy ? 'যাচাই হচ্ছে…' : 'লগইন'}
        </button>
      </form>
      <p className="mt-4 text-xs text-muted">পাসওয়ার্ড ভুলে গেলে আপনার ম্যানেজার বা সুপার অ্যাডমিনের সাথে যোগাযোগ করুন।</p>
    </AuthCard>
  );
}
