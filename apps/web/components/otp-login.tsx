'use client';

import { useState } from 'react';
import { api, ApiError, cartChanged } from '@/lib/api';

/** Phone + OTP login (also used inline at checkout — guest checkout uses the same verification). */
export function OtpLogin({ onDone, title = 'মোবাইল নম্বর দিয়ে প্রবেশ করুন' }: { onDone: () => void; title?: string }) {
  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ challengeId: string }>('/auth/otp/request', { method: 'POST', body: { phone } });
      setChallenge(r.challengeId);
      setInfo('আপনার মোবাইলে ৬ সংখ্যার কোড পাঠানো হয়েছে।');
    } catch (err) {
      setError(err instanceof ApiError ? (err.code === 'VALIDATION_FAILED' ? 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন (০১XXXXXXXXX)' : err.message) : 'কোড পাঠানো যায়নি');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/otp/verify', { method: 'POST', body: { challengeId: challenge, code: code.trim() } });
      cartChanged();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'OTP_EXPIRED' ? 'কোডের মেয়াদ শেষ বা অনেকবার ভুল হয়েছে। নতুন কোড নিন।' : 'কোডটি সঠিক নয়');
      if (err instanceof ApiError && err.code === 'OTP_EXPIRED') setChallenge(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {!challenge ? (
        <form onSubmit={(e) => void request(e)} className="mt-3 grid gap-3" noValidate>
          <div>
            <label htmlFor="phone" className="label">
              মোবাইল নম্বর
            </label>
            <input id="phone" className="field" inputMode="tel" autoComplete="tel" placeholder="০১XXXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} aria-describedby={error ? 'otp-error' : undefined} required />
          </div>
          <button className="btn btn-primary" disabled={busy || phone.length < 10}>
            {busy ? 'পাঠানো হচ্ছে…' : 'কোড পাঠান'}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void verify(e)} className="mt-3 grid gap-3" noValidate>
          {info && <p className="text-sm text-muted">{info}</p>}
          <div>
            <label htmlFor="code" className="label">
              কোড
            </label>
            <input id="code" className="field tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-describedby={error ? 'otp-error' : undefined} required />
          </div>
          <button className="btn btn-primary" disabled={busy || code.trim().length !== 6}>
            {busy ? 'যাচাই হচ্ছে…' : 'যাচাই করুন'}
          </button>
          <button type="button" className="text-sm text-accent-ink underline" onClick={() => setChallenge(null)}>
            নম্বর পরিবর্তন / নতুন কোড
          </button>
        </form>
      )}
      {error && (
        <p id="otp-error" role="alert" className="mt-3 rounded-lg bg-danger-bg p-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
