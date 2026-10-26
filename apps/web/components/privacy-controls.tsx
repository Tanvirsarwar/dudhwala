'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** Download my data, and ask for account deletion (processed by Dudhwala; order amounts are kept for accounting). */
export function PrivacyControls() {
  const [status, setStatus] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ deleteRequest: { status: string } | null }>('/me/privacy')
      .then((r) => setStatus(r.deleteRequest?.status ?? null))
      .catch(() => undefined);
  }, []);

  const download = async () => {
    setBusy(true);
    setMsg({});
    try {
      const data = await api('/me/privacy/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dudhwala-amar-tottho.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setMsg({ error: e instanceof ApiError ? e.message : 'ডাউনলোড করা যায়নি' });
    } finally {
      setBusy(false);
    }
  };

  const requestDelete = async () => {
    if (!window.confirm('আপনার অ্যাকাউন্ট মুছে ফেলার অনুরোধ পাঠাবেন? অনুমোদনের পর নাম, ফোন ও ঠিকানা মুছে যাবে এবং আবার লগইন করতে নতুন অ্যাকাউন্ট লাগবে।')) return;
    setBusy(true);
    setMsg({});
    try {
      await api('/me/privacy/delete-request', { method: 'POST', body: {} });
      setStatus('REQUESTED');
      setMsg({ ok: 'অনুরোধ পাঠানো হয়েছে। চলমান অর্ডার শেষ হলে প্রক্রিয়া করা হবে।' });
    } catch (e) {
      setMsg({ error: e instanceof ApiError ? e.message : 'অনুরোধ পাঠানো যায়নি' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-5" aria-labelledby="a-privacy">
      <h2 id="a-privacy" className="mb-3 text-lg font-bold">
        গোপনীয়তা
      </h2>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void download()}>
          আমার তথ্য ডাউনলোড
        </button>
        {status === 'REQUESTED' ? (
          <p className="self-center text-sm text-muted" role="status">
            অ্যাকাউন্ট মুছে ফেলার অনুরোধ প্রক্রিয়াধীন।
          </p>
        ) : (
          <button type="button" className="btn btn-ghost text-danger" disabled={busy} onClick={() => void requestDelete()}>
            অ্যাকাউন্ট মুছে ফেলার অনুরোধ
          </button>
        )}
      </div>
      {msg.error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {msg.error}
        </p>
      ) : null}
      {msg.ok ? (
        <p role="status" className="mt-2 text-sm text-success">
          {msg.ok}
        </p>
      ) : null}
    </section>
  );
}
