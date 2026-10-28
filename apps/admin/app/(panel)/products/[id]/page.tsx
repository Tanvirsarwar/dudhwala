'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState } from 'react';
import { zoneEligibility, type OuterCityStatus } from '@dudhwala/shared';
import { api } from '@/lib/api';
import { poishaToInput, toPoisha } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { AdminCategory, AdminProduct } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Field, Loading, Msg, PageTitle } from '@/components/ui';

interface VRow {
  id: string;
  labelBn: string;
  price: string;
  compare: string;
  stock: string;
  maxQty: string;
}
interface Form {
  nameBn: string;
  nameEn: string;
  categorySlug: string;
  active: boolean;
  nameVerified: boolean;
  outerCityStatus: OuterCityStatus | null;
  content: AdminProduct['content'];
  variants: VRow[];
}
const toForm = (p: AdminProduct): Form => ({
  nameBn: p.nameBn,
  nameEn: p.nameEn,
  categorySlug: p.categorySlug,
  active: p.active,
  nameVerified: p.nameVerified,
  outerCityStatus: p.outerCityStatus,
  content: { ...p.content },
  variants: p.variants.map((v) => ({ id: v.id, labelBn: v.labelBn, price: poishaToInput(v.pricePoisha), compare: poishaToInput(v.compareAtPoisha), stock: v.stock === null ? '' : String(v.stock), maxQty: String(v.maxQty) })),
});
const CONTENT: [keyof AdminProduct['content'], string][] = [
  ['descriptionBn', 'বিবরণ'],
  ['ingredientsBn', 'উপাদান'],
  ['allergensBn', 'অ্যালার্জি সংক্রান্ত তথ্য'],
  ['storageBn', 'সংরক্ষণের নিয়ম'],
  ['shelfLifeBn', 'মেয়াদ'],
];
const STOREFRONT = process.env.NEXT_PUBLIC_STOREFRONT_URL;

export default function ProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { canEdit } = useSession();
  const { data: p, error, setData } = useLoad<AdminProduct>(`/admin/products/${id}`);
  const cats = useLoad<AdminCategory[]>('/admin/categories');
  const [f, setF] = useState<Form | null>(null);
  const [saved, setSaved] = useState('');
  const save = useAction();
  const img = useAction();
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p) setF(toForm(p));
  }, [p]);
  if (!p || !f) return <Loading error={error} />;

  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(p));
  const ro = !canEdit;
  const set = (patch: Partial<Form>) => setF((x) => (x ? { ...x, ...patch } : x));
  const setV = (i: number, patch: Partial<VRow>) => set({ variants: f.variants.map((v, k) => (k === i ? { ...v, ...patch } : v)) });
  const outer = zoneEligibility({ categorySlug: f.categorySlug, outerCityStatus: f.outerCityStatus }, 'OUTER_CITY');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setSaved('');
    await save.run(async () => {
      const variants = f.variants.map((v, i) => {
        const price = toPoisha(v.price), compare = toPoisha(v.compare);
        if (v.price.trim() && price === null) throw new Error(`সাইজ ${i + 1}: দাম সঠিক নয়`);
        if (v.compare.trim() && compare === null) throw new Error(`সাইজ ${i + 1}: পুরোনো দাম সঠিক নয়`);
        if (v.stock.trim() && !/^\d+$/.test(v.stock.trim())) throw new Error(`সাইজ ${i + 1}: স্টক সংখ্যা হতে হবে`);
        if (!/^\d+$/.test(v.maxQty.trim()) || Number(v.maxQty) < 1) throw new Error(`সাইজ ${i + 1}: সর্বোচ্চ সংখ্যা ১ বা বেশি হতে হবে`);
        return { id: v.id, labelBn: v.labelBn, pricePoisha: price, compareAtPoisha: compare, stock: v.stock.trim() ? Number(v.stock) : null, maxQty: Number(v.maxQty) };
      });
      const next = await api<AdminProduct>(`/admin/products/${p!.id}`, { method: 'PATCH', body: { nameBn: f.nameBn, nameEn: f.nameEn, categorySlug: f.categorySlug, active: f.active, nameVerified: f.nameVerified, outerCityStatus: f.outerCityStatus, content: f.content, variants } });
      setData(next);
      setSaved('সংরক্ষণ হয়েছে');
    });
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file0 = e.target.files?.[0];
    e.target.value = '';
    if (!file0) return;
    await img.run(async () => {
      if (file0.size > 5 * 1024 * 1024) throw new Error('ছবি ৫ MB এর বেশি হতে পারবে না');
      const buf = new Uint8Array(await file0.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      setData(await api<AdminProduct>(`/admin/products/${p!.id}/image`, { body: { dataBase64: btoa(bin) } }));
    }, 'ছবি সংরক্ষণ হয়েছে');
  }

  return (
    <form onSubmit={submit} noValidate className="pb-24">
      <PageTitle title={p.nameBn}>
        <Link href="/products" className="btn btn-ghost btn-sm">
          ← সব পণ্য
        </Link>
        {STOREFRONT && p.active && (
          <a href={`${STOREFRONT}/p/${p.slug}`} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
            দোকানে দেখুন ↗
          </a>
        )}
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <section className="card h-fit p-4" aria-labelledby="img-h">
          <h2 id="img-h" className="mb-2 font-semibold">
            ছবি
          </h2>
          <div className="aspect-square overflow-hidden rounded-xl bg-brand-100">{p.image ? <img src={p.image} alt={p.nameBn} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm text-muted">ছবি নেই</div>}</div>
          {!ro && (
            <div className="mt-3 grid gap-2">
              <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="img-file" aria-label="ছবি বাছাই করুন" onChange={(e) => void upload(e)} />
              <button type="button" className="btn btn-ghost btn-sm" disabled={img.busy} aria-busy={img.busy} onClick={() => file.current?.click()}>
                {p.image ? 'ছবি বদলান' : 'ছবি যোগ করুন'}
              </button>
              {p.image && (
                <button type="button" className="btn btn-ghost btn-sm text-danger" disabled={img.busy} onClick={() => void img.run(async () => setData(await api<AdminProduct>(`/admin/products/${p.id}/image`, { method: 'DELETE' })), 'ছবি মুছে ফেলা হয়েছে')}>
                  ছবি মুছুন
                </button>
              )}
              <p className="text-xs text-muted">JPG, PNG বা WebP, ৫ MB পর্যন্ত। বর্গাকার ছবি সবচেয়ে ভালো দেখায়।</p>
            </div>
          )}
          <Msg error={img.error} ok={img.ok} />
        </section>

        <div className="grid min-w-0 content-start gap-4">
          <fieldset disabled={ro} className="card grid gap-0 p-4">
            <legend className="sr-only">মূল তথ্য</legend>
            <h2 className="mb-2 font-semibold">মূল তথ্য</h2>
            <div className="grid gap-x-4 md:grid-cols-2">
              <Field label="নাম (বাংলা)" id="f-bn">
                <input id="f-bn" className="field" value={f.nameBn} onChange={(e) => set({ nameBn: e.target.value })} required />
              </Field>
              <Field label="নাম (English)" id="f-en">
                <input id="f-en" className="field font-latin" value={f.nameEn} onChange={(e) => set({ nameEn: e.target.value })} required />
              </Field>
              <Field label="ক্যাটাগরি" id="f-cat">
                <select id="f-cat" className="field" value={f.categorySlug} onChange={(e) => set({ categorySlug: e.target.value })}>
                  {(cats.data ?? []).map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nameBn}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /> <span>দোকানে দেখান (বন্ধ করলে গ্রাহক এই পণ্য দেখবেন না)</span>
            </label>
            <label className="flex items-center gap-2 py-1">
              <input type="checkbox" checked={f.nameVerified} onChange={(e) => set({ nameVerified: e.target.checked })} /> <span>নামের বানান নিশ্চিত করা হয়েছে</span>
            </label>
          </fieldset>

          <fieldset disabled={ro} className="card p-4">
            <legend className="sr-only">দাম ও পরিমাণ</legend>
            <h2 className="mb-1 font-semibold">দাম ও পরিমাণ</h2>
            <p className="mb-2 text-sm text-muted">প্রতিটি সাইজ/ধরনের আলাদা দাম। সাইজ না থাকলে লেবেল খালি রাখুন। স্টক খালি রাখলে স্টক গোনা হবে না (সবসময় পাওয়া যাবে)।</p>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>লেবেল (যেমন: ৫০০ গ্রাম)</th>
                    <th>দাম (৳)</th>
                    <th>পুরোনো দাম (৳) — অফার</th>
                    <th>স্টক</th>
                    <th>কার্টে সর্বোচ্চ</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {f.variants.map((v, i) => (
                    <tr key={v.id}>
                      <td>
                        <input aria-label={`সাইজ ${i + 1} লেবেল`} className="field field-sm min-w-36" value={v.labelBn} onChange={(e) => setV(i, { labelBn: e.target.value })} />
                      </td>
                      <td>
                        <input aria-label={`সাইজ ${i + 1} দাম`} inputMode="decimal" className="field field-sm w-28 font-latin" value={v.price} placeholder="দাম নেই" onChange={(e) => setV(i, { price: e.target.value })} />
                      </td>
                      <td>
                        <input aria-label={`সাইজ ${i + 1} পুরোনো দাম`} inputMode="decimal" className="field field-sm w-28 font-latin" value={v.compare} onChange={(e) => setV(i, { compare: e.target.value })} />
                      </td>
                      <td>
                        <input aria-label={`সাইজ ${i + 1} স্টক`} inputMode="numeric" className="field field-sm w-24 font-latin" value={v.stock} placeholder="গোনা হয় না" onChange={(e) => setV(i, { stock: e.target.value })} />
                      </td>
                      <td>
                        <input aria-label={`সাইজ ${i + 1} সর্বোচ্চ`} inputMode="numeric" className="field field-sm w-24 font-latin" value={v.maxQty} onChange={(e) => setV(i, { maxQty: e.target.value })} />
                      </td>
                      <td>
                        {f.variants.length > 1 && (
                          <button type="button" className="btn btn-ghost btn-sm" aria-label={`সাইজ ${i + 1} সরান`} onClick={() => set({ variants: f.variants.filter((_, k) => k !== i) })}>
                            সরান
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => set({ variants: [...f.variants, { id: `new-${f.variants.length}-${Date.now()}`, labelBn: '', price: '', compare: '', stock: '', maxQty: '999' }] })}>
              + আরেকটি সাইজ যোগ করুন
            </button>
          </fieldset>

          <fieldset disabled={ro} className="card p-4">
            <legend className="sr-only">ডেলিভারি</legend>
            <h2 className="mb-2 font-semibold">আউটার সিটি ডেলিভারি</h2>
            <Field label="এই পণ্য সিলেটের বাইরে ডেলিভারি হবে?" id="f-outer">
              <select id="f-outer" className="field" value={f.outerCityStatus ?? ''} onChange={(e) => set({ outerCityStatus: (e.target.value || null) as OuterCityStatus | null })}>
                <option value="">ডিফল্ট (বেকারি হলে হ্যাঁ, অন্যথায় না)</option>
                <option value="approved">হ্যাঁ — আউটার সিটিতে চালু</option>
                <option value="disabled">না — আউটার সিটিতে বন্ধ</option>
                <option value="pending_verification">যাচাই বাকি (বন্ধ)</option>
                <option value="pending_confirmation">নিশ্চিত করা বাকি (বন্ধ)</option>
              </select>
            </Field>
            <p className={`rounded-xl p-3 text-sm ${outer.eligible ? 'bg-ok-bg text-success' : 'bg-brand-100 text-brand-700'}`}>
              <b>ফলাফল:</b> <span>{outer.eligible ? 'আউটার সিটিতে ১-২ দিনে ডেলিভারি হবে।' : 'আউটার সিটিতে ডেলিভারি হবে না।'}</span> <span>ইন সিটিতে সব পণ্য ২৪ ঘণ্টার মধ্যে ডেলিভারি হয়।</span>
            </p>
          </fieldset>

          <fieldset disabled={ro} className="card p-4">
            <legend className="sr-only">বিবরণ</legend>
            <h2 className="mb-2 font-semibold">বিবরণ</h2>
            {CONTENT.map(([k, label]) => (
              <Field key={k} label={label} id={`f-${k}`}>
                <textarea id={`f-${k}`} className="field min-h-20" rows={2} maxLength={2000} value={f.content[k] ?? ''} onChange={(e) => set({ content: { ...f.content, [k]: e.target.value } })} />
              </Field>
            ))}
          </fieldset>
        </div>
      </div>

      {!ro && (
        <div className="action-bar" role="region" aria-label="সংরক্ষণ">
          <span className="text-sm">{save.error ? <span className="text-danger">{save.error}</span> : saved && !dirty ? <span className="text-success">{saved}</span> : dirty ? 'সংরক্ষণ হয়নি এমন পরিবর্তন আছে' : 'কোনো পরিবর্তন নেই'}</span>
          <span className="flex gap-2">
            {dirty && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setF(toForm(p)); save.setError(null); }}>
                পরিবর্তন বাতিল
              </button>
            )}
            <button className="btn btn-primary btn-sm" disabled={!dirty || save.busy} aria-busy={save.busy}>
              সংরক্ষণ করুন
            </button>
          </span>
        </div>
      )}
    </form>
  );
}
