'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { zoneEligibility } from '@dudhwala/shared';
import type { AdminCategory, AdminProduct } from '@/lib/types';
import { api } from '@/lib/api';
import { poishaToInput, taka, toPoisha } from '@/lib/format';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { Badge, Field, Loading, Modal, Msg, PageTitle, StaleNotice, TableWrap } from '@/components/ui';

const FILTERS: [string, string][] = [
  ['', 'সব'],
  ['active', 'চালু'],
  ['hidden', 'লুকানো'],
  ['noprice', 'দাম নেই'],
  ['noimage', 'ছবি নেই'],
];

function ProductsInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const { canEdit } = useSession();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState(sp.get('category') ?? '');
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const qs = new URLSearchParams({ ...(q.trim() ? { q: q.trim() } : {}), ...(category ? { category } : {}), ...(status ? { status } : {}) }).toString();
  const list = useLoad<{ data: AdminProduct[]; total: number }>(`/admin/products${qs ? `?${qs}` : ''}`);
  const cats = useLoad<AdminCategory[]>('/admin/categories');
  // quick price entry: edits are kept per product until "save"
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [badPrice, setBadPrice] = useState<Set<string>>(new Set());
  const save = useAction();
  const [creating, setCreating] = useState(false);
  const create = useAction();
  const [nn, setNn] = useState({ nameBn: '', nameEn: '', categorySlug: '' });

  const rows = list.data?.data ?? [];
  const dirty = useMemo(() => Object.keys(prices), [prices]);

  const savePrices = () =>
    save.run(async () => {
      const bad = new Set<string>();
      const jobs: [AdminProduct, number | null][] = [];
      for (const id of dirty) {
        const p = rows.find((r) => r.id === id);
        const raw = prices[id] ?? '';
        const v = toPoisha(raw);
        if (!p) continue;
        if (raw.trim() && v === null) bad.add(id);
        else jobs.push([p, v]);
      }
      setBadPrice(bad);
      if (bad.size) throw new Error('কিছু দাম সঠিক নয় (লাল ঘরগুলো দেখুন)');
      for (const [p, v] of jobs) {
        const first = p.variants[0];
        if (!first) continue;
        const cmp = first.compareAtPoisha !== null && v !== null && first.compareAtPoisha > v ? first.compareAtPoisha : null;
        await api(`/admin/products/${p.id}`, { method: 'PATCH', body: { variants: p.variants.map((x, i) => (i === 0 ? { ...x, pricePoisha: v, compareAtPoisha: cmp } : x)) } });
      }
      setPrices({});
      await list.reload();
    }, 'দাম সংরক্ষণ হয়েছে');

  const toggle = (p: AdminProduct) => save.run(async () => { await api(`/admin/products/${p.id}`, { method: 'PATCH', body: { active: !p.active } }); await list.reload(); });

  return (
    <>
      <PageTitle title="পণ্য">
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + নতুন পণ্য
          </button>
        )}
      </PageTitle>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="pq">
            খুঁজুন
          </label>
          <input id="pq" className="field field-sm w-56" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="pc">
            ক্যাটাগরি
          </label>
          <select id="pc" className="field field-sm w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">সব</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.nameBn}
              </option>
            ))}
          </select>
        </div>
        <div role="group" aria-label="ফিল্টার" className="flex flex-wrap gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" className="pill" aria-pressed={status === k} onClick={() => setStatus(k)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {canEdit && <p className="mb-2 text-sm text-muted">দাম ঘরে সরাসরি লিখুন (টাকায়), তারপর নিচের "দাম সংরক্ষণ" চাপুন। একাধিক সাইজ থাকলে পণ্যের পাতায় যান।</p>}
      <Msg error={save.error} ok={save.ok} />
      <StaleNotice error={list.data ? list.error : null} onRetry={() => void list.reload()} />
      {!list.data ? (
        <Loading error={list.error} />
      ) : rows.length === 0 ? (
        <p className="card p-6 text-center text-sm text-muted">কোনো পণ্য পাওয়া যায়নি।</p>
      ) : (
        <TableWrap label="পণ্যের তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>ছবি</th>
                <th>নাম</th>
                <th>ক্যাটাগরি</th>
                <th>দাম (৳)</th>
                <th>স্টক</th>
                <th>আউটার সিলেট</th>
                <th>দোকানে</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const single = p.variants.length === 1;
                const v0 = p.variants[0];
                const outer = zoneEligibility({ categorySlug: p.categorySlug, outerCityStatus: p.outerCityStatus }, 'OUTER_CITY').eligible;
                const stockTxt = p.variants.every((v) => v.stock === null) ? 'ট্র্যাক হয় না' : p.variants.map((v) => v.stock ?? '—').join(' / ');
                return (
                  <tr key={p.id}>
                    <td>
                      {p.image ? <img src={p.image} alt="" width={44} height={44} className="h-11 w-11 rounded-lg object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-100 text-xs text-muted">নেই</span>}
                    </td>
                    <td>
                      <Link href={`/products/${p.id}`} className="font-semibold text-link underline">
                        {p.nameBn}
                      </Link>
                      <span className="block font-latin text-xs text-muted">{p.nameEn}</span>
                      {!p.nameVerified && <Badge tone="warn">নাম যাচাই বাকি</Badge>}
                    </td>
                    <td>{p.categoryNameBn}</td>
                    <td>
                      {single && canEdit ? (
                        <input
                          aria-label={`${p.nameBn} দাম`}
                          inputMode="decimal"
                          className={`field field-sm w-28 font-latin ${badPrice.has(p.id) ? 'border-danger' : ''}`}
                          placeholder="দাম নেই"
                          value={prices[p.id] ?? poishaToInput(v0?.pricePoisha ?? null)}
                          onChange={(e) => setPrices((m) => ({ ...m, [p.id]: e.target.value }))}
                        />
                      ) : single ? (
                        <span className="font-latin">{taka(v0?.pricePoisha ?? null)}</span>
                      ) : (
                        <span className="text-sm">{p.variants.length} টি সাইজ</span>
                      )}
                    </td>
                    <td className="text-sm">{stockTxt}</td>
                    <td>{outer ? <Badge tone="good">হ্যাঁ</Badge> : <Badge>না</Badge>}</td>
                    <td>
                      {canEdit ? (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggle(p)} aria-pressed={p.active}>
                          {p.active ? 'চালু' : 'লুকানো'}
                        </button>
                      ) : p.active ? (
                        <Badge tone="good">চালু</Badge>
                      ) : (
                        <Badge tone="bad">লুকানো</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <p className="mt-2 text-sm text-muted">
        <span>মোট:</span> <b>{list.data?.total ?? 0}</b> <span>টি পণ্য</span>
      </p>
      {dirty.length > 0 && (
        <div className="action-bar" role="region" aria-label="দাম সংরক্ষণ">
          <span className="text-sm">
            <b>{dirty.length}</b> <span>টি দাম বদলানো হয়েছে</span>
          </span>
          <span className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPrices({}); setBadPrice(new Set()); }}>
              বাতিল
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={save.busy} aria-busy={save.busy} onClick={() => void savePrices()}>
              দাম সংরক্ষণ
            </button>
          </span>
        </div>
      )}

      <Modal open={creating} title="নতুন পণ্য" onClose={() => setCreating(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create.run(async () => {
              const p = await api<AdminProduct>('/admin/products', { body: nn });
              router.push(`/products/${p.id}`);
            });
          }}
        >
          <Field label="নাম (বাংলা)" id="nn-bn">
            <input id="nn-bn" className="field" value={nn.nameBn} onChange={(e) => setNn({ ...nn, nameBn: e.target.value })} required />
          </Field>
          <Field label="নাম (English)" id="nn-en">
            <input id="nn-en" className="field font-latin" value={nn.nameEn} onChange={(e) => setNn({ ...nn, nameEn: e.target.value })} required />
          </Field>
          <Field label="ক্যাটাগরি" id="nn-cat">
            <select id="nn-cat" className="field" value={nn.categorySlug} onChange={(e) => setNn({ ...nn, categorySlug: e.target.value })} required>
              <option value="">বেছে নিন</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nameBn}
                </option>
              ))}
            </select>
          </Field>
          <Msg error={create.error} />
          <button className="btn btn-primary w-full" disabled={create.busy || !nn.nameBn || !nn.nameEn || !nn.categorySlug} aria-busy={create.busy}>
            তৈরি করুন
          </button>
          <p className="mt-2 text-xs text-muted">তৈরির পর দাম, ছবি ও বিবরণ পণ্যের পাতায় যোগ করুন।</p>
        </form>
      </Modal>
    </>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ProductsInner />
    </Suspense>
  );
}
