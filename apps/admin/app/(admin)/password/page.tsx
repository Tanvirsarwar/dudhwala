'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { Field, Msg, PageTitle } from '@/components/ui';

/** Change your own password. Other sessions of this account are signed out. */
export default function PasswordPage() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const a = useAction();
  const mismatch = again.length > 0 && next !== again;
  return (
    <>
      <PageTitle title="পাসওয়ার্ড পরিবর্তন" />
      <form
        className="card max-w-md p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => api('/auth/staff/password', { body: { currentPassword: current, newPassword: next } }), 'পাসওয়ার্ড পরিবর্তন হয়েছে। অন্য সব ডিভাইস থেকে লগআউট করা হয়েছে।').then((ok) => {
            if (ok) {
              setCurrent('');
              setNext('');
              setAgain('');
            }
          });
        }}
      >
        <Field label="বর্তমান পাসওয়ার্ড" id="pw-cur">
          <input id="pw-cur" type="password" autoComplete="current-password" className="field" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="নতুন পাসওয়ার্ড" id="pw-new" hint="কমপক্ষে ১২ অক্ষর। একটি লম্বা বাক্যাংশ সবচেয়ে ভালো।">
          <input id="pw-new" type="password" autoComplete="new-password" minLength={12} aria-describedby="pw-new-hint" className="field" value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        <Field label="নতুন পাসওয়ার্ড আবার" id="pw-again">
          <input id="pw-again" type="password" autoComplete="new-password" className="field" value={again} onChange={(e) => setAgain(e.target.value)} required aria-invalid={mismatch} />
        </Field>
        {mismatch ? (
          <p role="alert" className="mb-3 text-sm text-danger">
            দুটি পাসওয়ার্ড মিলছে না।
          </p>
        ) : null}
        <Msg error={a.error} ok={a.ok} />
        <button className="btn btn-primary" disabled={a.busy || mismatch || next.length < 12}>
          পরিবর্তন করুন
        </button>
      </form>
    </>
  );
}
