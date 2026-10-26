'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { poishaToInput, taka, toPoisha } from '@/lib/format';
import { PRODUCT_STATUS, type Category } from '@/lib/catalog';
import { Badge, Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

interface Variant {
  id: string;
  sku: string;
  labelBn: string;
  labelEn: string | null;
  packSize: string;
  packUnit: string;
  pricePoisha: number;
  compareAtPoisha: number | null;
  status: string;
  sortOrder: number;
}

interface Product {
  id: string;
  categoryId: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  descriptionBn: string | null;
  ingredientsBn: string | null;
  allergensBn: string | null;
  storageBn: string | null;
  shelfLifeBn: string | null;
  status: string;
  contentApprovedAt: string | null;
  variants: Variant[];
  images: { id: string; url: string; altBn: string; sortOrder: number }[];
}

const CONTENT: { key: keyof Product; label: string; rows: number; hint?: string }[] = [
  { key: 'descriptionBn', label: 'বিবরণ', rows: 4 },
  { key: 'ingredientsBn', label: 'উপাদান', rows: 2 },
  { key: 'allergensBn', label: 'অ্যালার্জেন', rows: 2, hint: 'যেমন: দুধ। ব্যবসার কাছ থেকে নিশ্চিত তথ্য ছাড়া লিখবেন না।' },
  { key: 'storageBn', label: 'সংরক্ষণ', rows: 2, hint: 'যেমন: ৪°সে এর নিচে ফ্রিজে রাখুন।' },
  { key: 'shelfLifeBn', label: 'মেয়াদ', rows: 1 },
];

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession();
  const canEdit = s.can('catalog.manage');
  const { data: p, error, reload } = useLoad<Product>(`/admin/products/${id}`);
  const cats = useLoad<Category[]>('/admin/categories');
  const [form, setForm] = useState<Record<string, string>>({});
  const [variantOpen, setVariantOpen] = useState<Variant | 'new' | null>(null);
  const a = useAction();

  useEffect(() => {
    if (!p) return;
    const f: Record<string, string> = { nameBn: p.nameBn, nameEn: p.nameEn ?? '', slug: p.slug, categoryId: p.categoryId };
    for (const c of CONTENT) f[c.key] = (p[c.key] as string | null) ?? '';
    setForm(f);
  }, [p]);

  if (!p) return <Loading error={error} />;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!p) return;
    const body: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(form)) {
      const before = k === 'nameEn' || CONTENT.some((c) => c.key === k) ? ((p[k as keyof Product] as string | null) ?? '') : String(p[k as keyof Product]);
      if (v !== before) body[k] = v.trim() === '' && k !== 'nameBn' && k !== 'slug' && k !== 'categoryId' ? null : v.trim();
    }
    if (!Object.keys(body).length) return a.setOk('কোনো পরিবর্তন নেই');
    if ((await a.run(() => api(`/admin/products/${p.id}`, { method: 'PATCH', body }), 'সংরক্ষিত হয়েছে'))) await reload();
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/catalog" className="text-brand-600 underline">
          ← পণ্য তালিকা
        </Link>
      </p>
      <PageTitle title={p.nameBn}>
        <Badge tone={PRODUCT_STATUS[p.status]?.tone}>{PRODUCT_STATUS[p.status]?.label ?? p.status}</Badge>
        {s.can('catalog.publish') && p.status !== 'ACTIVE' ? (
          <button className="btn btn-primary btn-sm" disabled={a.busy} onClick={() => void a.run(() => api(`/admin/products/${p.id}/publish`, { method: 'POST' }), 'প্রকাশিত হয়েছে — গ্রাহকরা এখন দেখতে পাবেন (স্টক থাকলে)').then((ok) => (ok ? reload() : undefined))}>
            প্রকাশ করুন
          </button>
        ) : null}
        {canEdit && p.status !== 'ARCHIVED' ? (
          <button className="btn btn-ghost btn-sm text-danger" disabled={a.busy} onClick={() => void a.run(() => api(`/admin/products/${p.id}/archive`, { method: 'POST' }), 'আর্কাইভ করা হয়েছে').then((ok) => (ok ? reload() : undefined))}>
            আর্কাইভ
          </button>
        ) : null}
      </PageTitle>
      {p.status === 'DRAFT' && p.contentApprovedAt === null ? <p className="mb-3 text-sm text-warning">খসড়া: প্রকাশিত পণ্যের তথ্য বদলালে আবার প্রকাশ করতে হয় (সুপার অ্যাডমিন অনুমোদন)।</p> : null}
      <Msg error={a.error} ok={a.ok} />

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <form className="card p-4" onSubmit={save} aria-labelledby="h-info">
          <h2 id="h-info" className="mb-3 font-semibold">
            তথ্য
          </h2>
          <fieldset disabled={!canEdit}>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <Field label="নাম (বাংলা)" id="f-nameBn">
                <input id="f-nameBn" className="field" value={form.nameBn ?? ''} onChange={set('nameBn')} required />
              </Field>
              <Field label="নাম (English)" id="f-nameEn">
                <input id="f-nameEn" className="field" value={form.nameEn ?? ''} onChange={set('nameEn')} />
              </Field>
              <Field label="URL স্লাগ" id="f-slug">
                <input id="f-slug" className="field font-latin" value={form.slug ?? ''} onChange={set('slug')} required />
              </Field>
              <Field label="ক্যাটাগরি" id="f-cat">
                <select id="f-cat" className="field" value={form.categoryId ?? ''} onChange={set('categoryId')}>
                  {(cats.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nameBn}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {CONTENT.map((c) => (
              <Field key={c.key} label={`${c.label} (ঐচ্ছিক)`} id={`f-${c.key}`} hint={c.hint}>
                <textarea id={`f-${c.key}`} className="field" rows={c.rows} value={form[c.key] ?? ''} onChange={set(c.key)} aria-describedby={c.hint ? `f-${c.key}-hint` : undefined} />
              </Field>
            ))}
            <p className="mb-3 text-xs text-muted">খালি রাখা তথ্য গ্রাহকের পাতায় দেখানো হয় না। অনুমান করে কিছু লিখবেন না।</p>
            {canEdit ? (
              <button className="btn btn-primary" disabled={a.busy}>
                সংরক্ষণ
              </button>
            ) : null}
          </fieldset>
        </form>

        <div className="space-y-4">
          <section className="card p-4" aria-labelledby="h-var">
            <div className="mb-2 flex items-center justify-between">
              <h2 id="h-var" className="font-semibold">
                ভ্যারিয়েন্ট ও দাম
              </h2>
              {canEdit ? (
                <button className="btn btn-ghost btn-sm" onClick={() => setVariantOpen('new')}>
                  যোগ করুন
                </button>
              ) : null}
            </div>
            {p.variants.length === 0 ? <p className="text-sm text-muted">প্রকাশের আগে অন্তত একটি ভ্যারিয়েন্ট যোগ করুন।</p> : null}
            <TableWrap label="ভ্যারিয়েন্ট">
              <table className="tbl">
                <tbody>
                  {p.variants.map((v) => (
                    <tr key={v.id}>
                      <td>
                        {v.labelBn}
                        <div className="font-latin text-xs text-muted">{v.sku}</div>
                      </td>
                      <td className="text-right font-latin">
                        {taka(v.pricePoisha)}
                        {v.compareAtPoisha ? <div className="text-xs text-muted line-through">{taka(v.compareAtPoisha)}</div> : null}
                      </td>
                      <td>
                        <Badge tone={PRODUCT_STATUS[v.status]?.tone}>{PRODUCT_STATUS[v.status]?.label ?? v.status}</Badge>
                      </td>
                      <td>
                        {canEdit ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => setVariantOpen(v)} aria-label={`${v.labelBn} সম্পাদনা`}>
                            সম্পাদনা
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </section>
          <Images product={p} canEdit={canEdit} onChange={reload} />
        </div>
      </div>
      {variantOpen ? <VariantDialog productId={p.id} variant={variantOpen === 'new' ? null : variantOpen} canPrice={s.can('pricing.manage_global')} onClose={() => setVariantOpen(null)} onDone={reload} /> : null}
    </>
  );
}

function VariantDialog({ productId, variant, canPrice, onClose, onDone }: { productId: string; variant: Variant | null; canPrice: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [sku, setSku] = useState(variant?.sku ?? '');
  const [labelBn, setLabelBn] = useState(variant?.labelBn ?? '');
  const [packSize, setPackSize] = useState(variant?.packSize ? String(Number(variant.packSize)) : '');
  const [packUnit, setPackUnit] = useState(variant?.packUnit ?? 'ML');
  const [price, setPrice] = useState(poishaToInput(variant?.pricePoisha));
  const [compare, setCompare] = useState(poishaToInput(variant?.compareAtPoisha));
  const [archived, setArchived] = useState(variant?.status === 'ARCHIVED');
  const a = useAction();
  const priceP = toPoisha(price);
  const compareP = compare.trim() ? toPoisha(compare) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await a.run(() => {
      if (!variant) return api(`/admin/products/${productId}/variants`, { body: { sku: sku.trim().toUpperCase(), labelBn, packSize: Number(packSize), packUnit, pricePoisha: priceP, compareAtPoisha: compareP } });
      const body: Record<string, unknown> = {};
      if (labelBn !== variant.labelBn) body.labelBn = labelBn;
      if (priceP !== variant.pricePoisha) body.pricePoisha = priceP;
      if (compareP !== variant.compareAtPoisha) body.compareAtPoisha = compareP;
      if (archived !== (variant.status === 'ARCHIVED')) body.status = archived ? 'ARCHIVED' : 'ACTIVE';
      return api(`/admin/variants/${variant.id}`, { method: 'PATCH', body });
    });
    if (ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <Modal open title={variant ? 'ভ্যারিয়েন্ট সম্পাদনা' : 'নতুন ভ্যারিয়েন্ট'} onClose={onClose}>
      <form onSubmit={submit}>
        {!variant ? (
          <>
            <Field label="SKU" id="v-sku" hint="ইংরেজি বড় হাতের অক্ষর, সংখ্যা, হাইফেন; যেমন MILK-1L।">
              <input id="v-sku" className="field font-latin uppercase" value={sku} onChange={(e) => setSku(e.target.value)} required aria-describedby="v-sku-hint" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="প্যাকের আকার" id="v-size">
                <input id="v-size" type="number" min={0} step="any" className="field font-latin" value={packSize} onChange={(e) => setPackSize(e.target.value)} required />
              </Field>
              <Field label="একক" id="v-unit">
                <select id="v-unit" className="field" value={packUnit} onChange={(e) => setPackUnit(e.target.value)}>
                  {['ML', 'L', 'G', 'KG', 'PCS'].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
            </div>
          </>
        ) : null}
        <Field label="লেবেল (বাংলা)" id="v-label" hint="গ্রাহক যা দেখবেন, যেমন ১ লিটার।">
          <input id="v-label" className="field" value={labelBn} onChange={(e) => setLabelBn(e.target.value)} required aria-describedby="v-label-hint" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="দাম (৳)" id="v-price">
            <input id="v-price" className="field font-latin" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required disabled={!!variant && !canPrice} />
          </Field>
          <Field label="আগের দাম (৳, ঐচ্ছিক)" id="v-compare">
            <input id="v-compare" className="field font-latin" inputMode="decimal" value={compare} onChange={(e) => setCompare(e.target.value)} disabled={!!variant && !canPrice} />
          </Field>
        </div>
        {variant && !canPrice ? <p className="mb-3 text-xs text-muted">দাম বদলাতে সুপার অ্যাডমিনের অনুমতি লাগে।</p> : null}
        <p className="mb-3 text-xs text-muted">নতুন দাম শুধু নতুন অর্ডারে প্রযোজ্য; আগের অর্ডারের দাম বদলায় না।</p>
        {variant ? (
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> আর্কাইভ (বিক্রি বন্ধ)
          </label>
        ) : null}
        <Msg error={a.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            বাতিল
          </button>
          <button className="btn btn-primary" disabled={a.busy || priceP === null || !labelBn || (compareP !== null && compareP <= (priceP ?? 0))}>
            সংরক্ষণ
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Images({ product, canEdit, onChange }: { product: Product; canEdit: boolean; onChange: () => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState(product.nameBn);
  const a = useAction();

  return (
    <section className="card p-4" aria-labelledby="h-img">
      <h2 id="h-img" className="mb-2 font-semibold">
        ছবি
      </h2>
      <p className="mb-2 text-xs text-muted">শুধু আসল পণ্যের ছবি। আপলোডের সময় ছবি WebP-তে রূপান্তর ও মেটাডেটা মুছে ফেলা হয় (সর্বোচ্চ ৫ MB)।</p>
      <ul className="mb-3 grid grid-cols-3 gap-2">
        {product.images.map((img) => (
            <li key={img.id} className="relative">
              <img src={img.url} alt={img.altBn} className="aspect-square w-full rounded-lg bg-brand-100 object-cover" />
              {canEdit ? (
                <button
                  className="btn btn-ghost btn-sm mt-1 w-full text-danger"
                  onClick={() => void a.run(() => api(`/admin/product-images/${img.id}/delete`, { method: 'POST' })).then((ok) => (ok ? onChange() : undefined))}
                >
                  মুছুন
                </button>
              ) : null}
            </li>
          ))}
      </ul>
      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            const fd = new FormData();
            fd.set('file', file);
            fd.set('altBn', alt);
            void a.run(() => api(`/admin/products/${product.id}/images`, { form: fd }), 'ছবি যোগ হয়েছে').then(async (ok) => {
              if (ok) {
                setFile(null);
                (e.target as HTMLFormElement).reset();
                await onChange();
              }
            });
          }}
        >
          <Field label="ছবি ফাইল" id="i-file">
            <input id="i-file" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="ছবির বর্ণনা (alt)" id="i-alt">
            <input id="i-alt" className="field" value={alt} onChange={(e) => setAlt(e.target.value)} required />
          </Field>
          <Msg error={a.error} ok={a.ok} />
          <button className="btn btn-ghost btn-sm" disabled={!file || !alt || a.busy}>
            আপলোড
          </button>
        </form>
      ) : null}
    </section>
  );
}
