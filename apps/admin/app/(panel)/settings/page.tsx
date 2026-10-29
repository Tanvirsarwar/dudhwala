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
  deliveryFees?: { IN_CITY: number; OUTER_CITY: number };
}
interface Outlets {
  data: { id: string; code: string; nameBn: string; status: string }[];
  dispatchOutletId: string | null;
  collectionOutletId: string | null;
}
const DEMO = process.env.NEXT_PUBLIC_DEMO_BRANDING === '1';

export default function SettingsPage() {
  const router = useRouter();
  const { canEdit } = useSession();
  const { data, error, reload } = useLoad<Cfg>('/admin/config');
  const outlets = useLoad<Outlets>('/admin/outlets');
  const roles = useAction();
  const [f, setF] = useState({ open: '', close: '', qty: '', amount: '', feeIn: '0', feeOut: '0' });
  const save = useAction();
  const reset = useAction();
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (!canEdit) router.replace('/');
  }, [canEdit, router]);
  useEffect(() => {
    if (data) setF({ open: minutesToHHMM(data.hours.openMinute), close: minutesToHHMM(data.hours.closeMinute), qty: String(data.bulk.minTotalQuantity), amount: poishaToInput(data.bulk.minTotalPoisha), feeIn: poishaToInput(data.deliveryFees?.IN_CITY ?? 0) || '0', feeOut: poishaToInput(data.deliveryFees?.OUTER_CITY ?? 0) || '0' });
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
            if (!/^\d+$/.test(f.qty) || Number(f.qty) < 1) throw new Error('শোরুম অর্ডারের ন্যূনতম সংখ্যা ১ বা বেশি হতে হবে');
            if (!/^\d+$/.test(f.amount) || Number(f.amount) < 1) throw new Error('শোরুম অর্ডারের ন্যূনতম টাকা পূর্ণ সংখ্যায় লিখুন');
            if (!/^\d+$/.test(f.feeIn) || !/^\d+$/.test(f.feeOut)) throw new Error('ডেলিভারি চার্জ পূর্ণ টাকায় লিখুন (০ হলে ফ্রি)');
            await api('/admin/config', { method: 'PUT', body: { hours: { open: f.open, close: f.close }, bulk: { minTotalQuantity: Number(f.qty), minTotalTaka: Number(f.amount) }, deliveryFeesTaka: { IN_CITY: Number(f.feeIn), OUTER_CITY: Number(f.feeOut) } } });
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
        <h2 className="mb-2 mt-4 font-semibold">শোরুম অর্ডারের ন্যূনতম সীমা</h2>
        {data.bulk.isPlaceholder && <p className="mb-2 rounded-xl bg-warn-bg p-3 text-sm">এখনকার মান শুধু অস্থায়ী (অনুমোদিত নয়)। আপনার আসল সীমা দিয়ে সংরক্ষণ করুন।</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="মোট পণ্যের সংখ্যা (টি)" id="s-qty">
            <input id="s-qty" inputMode="numeric" className="field font-latin" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} required />
          </Field>
          <Field label="অথবা মোট টাকা (৳)" id="s-amt">
            <input id="s-amt" inputMode="numeric" className="field font-latin" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
          </Field>
        </div>
        <p className="mb-3 text-sm text-muted">যেকোনো একটি পূরণ হলেই অর্ডারটি শোরুম অর্ডার হবে (শুধু মদিনা মার্কেট শাখা থেকে সংগ্রহ)।</p>
        <h2 className="mb-2 mt-4 font-semibold">ডেলিভারি চার্জ (হোম ডেলিভারি, টাকা)</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ইন সিলেট" id="s-fin">
            <input id="s-fin" inputMode="numeric" className="field font-latin" value={f.feeIn} onChange={(e) => setF({ ...f, feeIn: e.target.value })} required />
          </Field>
          <Field label="আউটার সিলেট" id="s-fout">
            <input id="s-fout" inputMode="numeric" className="field font-latin" value={f.feeOut} onChange={(e) => setF({ ...f, feeOut: e.target.value })} required />
          </Field>
        </div>
        <p className="mb-3 text-sm text-muted">০ মানে ফ্রি। পিকআপ ও শোরুম থেকে নিলে কোনো চার্জ নেই। পেমেন্ট শুধু ক্যাশ অন ডেলিভারি।</p>
        <Msg error={save.error} ok={save.ok} />
        <button className="btn btn-primary" disabled={save.busy} aria-busy={save.busy}>
          সংরক্ষণ করুন
        </button>
      </form>

      <section className="card mt-6 max-w-xl p-4" aria-labelledby="roles">
        <h2 id="roles" className="mb-2 font-semibold">
          আউটলেট
        </h2>
        {outlets.data && outlets.data.data.length > 0 ? (
          <>
            {([['dispatchOutletId', 'হোম ডেলিভারির স্টক যে আউটলেট থেকে'], ['collectionOutletId', 'শোরুম থেকে অর্ডার নেওয়ার আউটলেট (মদিনা মার্কেট শাখা)']] as const).map(([k, label]) => (
              <Field key={k} label={label} id={k}>
                <select
                  id={k}
                  className="field"
                  value={outlets.data?.[k] ?? ''}
                  onChange={(e) => void roles.run(async () => { await api('/admin/fulfilment-outlets', { method: 'PUT', body: { [k]: e.target.value || null } }); await outlets.reload(); }, 'সংরক্ষণ হয়েছে')}
                >
                  <option value="">— বেছে নেওয়া হয়নি —</option>
                  {outlets.data?.data.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nameBn} ({o.code})
                    </option>
                  ))}
                </select>
              </Field>
            ))}
            <Msg error={roles.error} ok={roles.ok} />
          </>
        ) : (
          <p className="notice notice-warn text-sm">কোনো আউটলেট নেই। মালিকের দেওয়া তথ্য দিয়ে সেটআপ কমান্ড চালান (docs/SETUP_OWNER_DATA.md)।</p>
        )}
      </section>

      {DEMO && (
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
      )}
    </>
  );
}
