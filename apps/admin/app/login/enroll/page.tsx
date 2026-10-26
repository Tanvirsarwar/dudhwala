'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api, errorText } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { Field, Msg } from '@/components/ui';
import { AuthCard } from '../auth-card';

/** First login of an MFA role: set up an authenticator app, confirm a code, save recovery codes. */
export default function EnrollPage() {
  const [setup, setSetup] = useState<{ otpauthUri: string; secret: string; qr: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const a = useAction();

  useEffect(() => {
    api<{ otpauthUri: string; secret: string }>('/auth/staff/mfa/enroll', { method: 'POST' })
      .then(async (s) => setSetup({ ...s, qr: await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 200 }) }))
      .catch((e: unknown) => setLoadError(errorText(e)));
  }, []);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    await a.run(async () => {
      const r = await api<{ recoveryCodes: string[] }>('/auth/staff/mfa/confirm', { body: { code: code.replace(/\s/g, '') } });
      setRecovery(r.recoveryCodes);
    });
  }

  if (recovery) {
    return (
      <AuthCard title="রিকভারি কোড সংরক্ষণ করুন">
        <p className="mb-2 text-sm">ফোন হারালে এই কোডগুলো দিয়ে লগইন করা যাবে। প্রতিটি কোড একবার ব্যবহার করা যায়। এগুলো আর দেখানো হবে না — এখনই নিরাপদ জায়গায় লিখে রাখুন।</p>
        <ul className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-milk p-3 font-latin text-sm" aria-label="রিকভারি কোড">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <a className="btn btn-primary w-full" href="/">
          সংরক্ষণ করেছি — চালিয়ে যান
        </a>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="দুই-ধাপ যাচাই চালু করুন">
      {loadError ? <Msg error={loadError} /> : null}
      {!setup && !loadError ? <p className="text-sm text-muted">লোড হচ্ছে…</p> : null}
      {setup ? (
        <form onSubmit={confirm}>
          <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm">
            <li>ফোনে একটি অথেনটিকেটর অ্যাপ খুলুন (যেমন Google Authenticator, Microsoft Authenticator)।</li>
            <li>নিচের QR কোড স্ক্যান করুন, অথবা গোপন কী টাইপ করুন।</li>
            <li>অ্যাপে দেখানো ৬ অঙ্কের কোড লিখুন।</li>
          </ol>
          <img src={setup.qr} alt="অথেনটিকেটর সেটআপের QR কোড" width={200} height={200} className="mx-auto mb-2" />
          <p className="mb-3 break-all text-center font-latin text-xs" aria-label="গোপন কী">
            <span className="text-muted">গোপন কী: </span>
            <code data-testid="totp-secret">{setup.secret}</code>
          </p>
          <Field label="৬ অঙ্কের কোড" id="code">
            <input id="code" className="field font-latin tracking-widest" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
          </Field>
          <Msg error={a.error} />
          <button className="btn btn-primary w-full" disabled={a.busy || code.trim().length < 6}>
            চালু করুন
          </button>
        </form>
      ) : null}
    </AuthCard>
  );
}
