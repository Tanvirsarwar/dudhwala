'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { Field, Msg } from '@/components/ui';
import { AuthCard } from '../auth-card';

/** Second step for MFA roles: a 6-digit authenticator code or a recovery code. */
export default function MfaPage() {
  const [code, setCode] = useState('');
  const a = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!(await a.run(() => api('/auth/staff/mfa', { body: { code: code.replace(/\s/g, '') } })))) return;
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  return (
    <AuthCard title="দুই-ধাপ যাচাই">
      <form onSubmit={submit}>
        <Field label="অথেনটিকেটর কোড" id="code" hint="অথেনটিকেটর অ্যাপের ৬ অঙ্কের কোড, অথবা একটি রিকভারি কোড।">
          <input id="code" className="field font-latin tracking-widest" inputMode="numeric" autoComplete="one-time-code" aria-describedby="code-hint" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Msg error={a.error} />
        <button className="btn btn-primary w-full" disabled={a.busy || code.trim().length < 6}>
          যাচাই করুন
        </button>
      </form>
    </AuthCard>
  );
}
