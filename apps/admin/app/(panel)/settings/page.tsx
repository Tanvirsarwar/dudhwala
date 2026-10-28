'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hhmmToMinutes, minutesToHHMM } from '@dudhwala/shared';
import { api } from '@/lib/api';
import { poishaToInput } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { Field, Loading, Msg, PageTitle } from '@/components/ui';

interface Cfg {
  hours: { openMinute: number; closeMinute: number };
  bulk: { minTotalQuantity: number; minTotalPoisha: number; isPlaceholder: boolean };
}

export default function SettingsPage() {
  const router = useRouter();
  const { canEdit } = useSession();
  const { data, error, reload } = useLoad<Cfg>('/admin/config');
  const [f, setF] = useState({ open: '', close: '', qty: '', amount: '' });
  const save = useAction();
  const reset = useAction();
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (!canEdit) router.replace('/');
  }, [canEdit, router]);
  useEffect(() => {
    if (data) setF({ open: minutesToHHMM(data.hours.openMinute), close: minutesToHHMM(data.hours.closeMinute), qty: String(data.bulk.minTotalQuantity), amount: poishaToInput(data.bulk.minTotalPoisha) });
  }, [data]);
  if (!canEdit || !data) return <Loading error={error} />;

  return (
    <>
      <PageTitle title="সেটিংস" />
      <form
        className="card max-w-xl p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save.run(async () => {
            const open = hhmmToMinutes(f.open), close = hhmmToMinutes(f.close);
            if (open === null || close === null || open >= close) throw new Error('খোলার সময় বন্ধের সময়ের আগে হতে হবে');
            if (!/^\d+$/.test(f.qty) || Number(f.qty) < 1) throw new Error('বাল্কের ন্যূনতম সংখ্যা ১ বা বেশি হতে হবে');
            if (!/^\d+$/.test(f.amount) || Number(f.amount) < 1) throw new Error('বাল্কের ন্যূনতম টাকা পূর্ণ সংখ্যায় লিখুন');
            await api('/admin/config', { method: 'PUT', body: { hours: { open: f.open, close: f.close }, bulk: { minTotalQuantity: Number(f.qty), minTotalTaka: Number(f.amount) } } });
            await reload();
          }, 'সংরক্ষণ হয়েছে। দোকানে এক মিনিটের মধ্যে কার্যকর হবে।');
        }}
      >
        <h2 className="mb-2 font-semibold">অর্ডার নেওয়ার সময় (ঢাকার সময়)</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="খোলে" id="s-open">
            <input id="s-open" type="time" className="field font-latin" value={f.open} onChange={(e) => setF({ ...f, open: e.target.value })} required />
          </Field>
          <Field label="বন্ধ হয়" id="s-close">
            <input id="s-close" type="time" className="field font-latin" value={f.close} onChange={(e) => setF({ ...f, close: e.target.value })} required />
          </Field>
        </div>
        <p className="mb-3 text-sm text-muted">এই সময়ের বাইরে দোকানে অর্ডার নেওয়া বন্ধ থাকে।</p>
        <h2 className="mb-2 mt-4 font-semibold">বাল্ক অর্ডারের ন্যূনতম সীমা</h2>
        {data.bulk.isPlaceholder && <p className="mb-2 rounded-xl bg-[#fff4cc] p-3 text-sm">এখনকার মান শুধু অস্থায়ী (ডেমো)। আপনার আসল সীমা দিয়ে সংরক্ষণ করুন।</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="মোট পণ্যের সংখ্যা (টি)" id="s-qty">
            <input id="s-qty" inputMode="numeric" className="field font-latin" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          </Field>
          <Field label="অথবা মোট টাকা (৳)" id="s-amt">
            <input id="s-amt" inputMode="numeric" className="field font-latin" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
          </Field>
        </div>
        <p className="mb-3 text-sm text-muted">যেকোনো একটি পূরণ হলেই অর্ডারটি বাল্ক হবে (শুধু মদিনা মার্কেট শাখা থেকে সংগ্রহ)।</p>
        <Msg error={save.error} ok={save.ok} />
        <button className="btn btn-primary" disabled={save.busy} aria-busy={save.busy}>
          সংরক্ষণ করুন
        </button>
      </form>

      <section className="card mt-6 max-w-xl border-red-200 p-4" aria-labelledby="danger">
        <h2 id="danger" className="mb-1 font-semibold text-danger">
          ডেমো ডেটা রিসেট
        </h2>
        <p className="mb-2 text-sm text-muted">সব অর্ডার, দাম, সম্পাদনা ও সেটিংস মুছে প্রথম অবস্থায় ফিরে যায় (আপলোড করা ছবি থাকে)। এটি ফেরানো যায় না।</p>
        <label className="label" htmlFor="rst">
          নিশ্চিত করতে <b className="font-latin">RESET</b> লিখুন
        </label>
        <input id="rst" className="field field-sm mb-2 w-40 font-latin" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Msg error={reset.error} ok={reset.ok} />
        <button type="button" className="btn btn-danger btn-sm" disabled={confirm !== 'RESET' || reset.busy} onClick={() => void reset.run(async () => { await api('/admin/reset', { method: 'POST', body: {} }); setConfirm(''); await reload(); }, 'রিসেট হয়েছে')}>
          রিসেট করুন
        </button>
      </section>
    </>
  );
}
