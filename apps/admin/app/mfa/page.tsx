'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { Field, Msg } from '@/components/ui';
import { AuthCard } from '../login/auth-card';

type Me = { user: { mfaEnabled: boolean }; role: 'ADMIN' | 'MANAGER' };

/** Two-factor step after the password: enter the authenticator code, or enrol first (admins must). */
export default function MfaPage() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [secret, setSecret] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const a = useAction();

  useEffect(() => {
    api<Me>('/me')
      .then((m) => setEnrolled(m.user.mfaEnabled))
      .catch(() => (window.location.href = '/login'));
  }, []);

  const begin = () => a.run(async () => setSecret(await api<{ secret: string; otpauthUri: string }>('/auth/staff/mfa/enroll', { body: {} })));
  const confirm = () => a.run(async () => setRecovery((await api<{ recoveryCodes: string[] }>('/auth/staff/mfa/confirm', { body: { code: code.trim() } })).recoveryCodes));
  const verify = async () => {
    if (await a.run(async () => void (await api('/auth/staff/mfa', { body: { code: code.trim() } })))) window.location.href = '/';
  };

  if (enrolled === null) return <AuthCard title="দুই-ধাপ যাচাই"><p className="text-muted">লোড হচ্ছে…</p></AuthCard>;
  if (recovery)
    return (
      <AuthCard title="রিকভারি কোড সংরক্ষণ করুন">
        <p className="mb-2 text-sm">ফোন হারালে এই কোডগুলো দিয়ে ঢুকতে পারবেন। প্রতিটি একবারই কাজ করে। এখনই নিরাপদ জায়গায় লিখে রাখুন — আর দেখানো হবে না।</p>
        <ul className="font-latin mb-3 grid grid-cols-2 gap-1 rounded-xl bg-brand-100 p-3 text-sm">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <button className="btn btn-primary w-full" onClick={() => (window.location.href = '/')}>
          সংরক্ষণ করেছি, এগিয়ে যান
        </button>
      </AuthCard>
    );
  if (!enrolled)
    return (
      <AuthCard title="দুই-ধাপ যাচাই চালু করুন">
        {!secret ? (
          <>
            <p className="mb-3 text-sm">অ্যাডমিন অ্যাকাউন্টে অথেন্টিকেটর অ্যাপ (Google Authenticator, Authy ইত্যাদি) বাধ্যতামূলক।</p>
            <Msg error={a.error} />
            <button className="btn btn-primary w-full" disabled={a.busy} onClick={() => void begin()}>
              শুরু করুন
            </button>
          </>
        ) : (
          <>
            <p className="mb-2 text-sm">অ্যাপে “key দিয়ে যোগ করুন” বেছে এই কোডটি দিন:</p>
            <p className="font-latin mb-2 break-all rounded-xl bg-brand-100 p-3 text-sm font-bold">{secret.secret}</p>
            <p className="font-latin mb-3 break-all text-xs text-muted">{secret.otpauthUri}</p>
            <Field label="অ্যাপে দেখানো ৬ সংখ্যার কোড" id="c">
              <input id="c" className="field font-latin" inputMode="numeric" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Msg error={a.error} />
            <button className="btn btn-primary w-full" disabled={a.busy || code.trim().length !== 6} onClick={() => void confirm()}>
              নিশ্চিত করুন
            </button>
          </>
        )}
      </AuthCard>
    );
  return (
    <AuthCard title="দুই-ধাপ যাচাই">
      <Field label="অথেন্টিকেটর কোড (বা রিকভারি কোড)" id="c">
        <input id="c" className="field font-latin" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Field>
      <Msg error={a.error} />
      <button className="btn btn-primary w-full" disabled={a.busy || code.trim().length < 6} onClick={() => void verify()}>
        যাচাই করুন
      </button>
    </AuthCard>
  );
}
