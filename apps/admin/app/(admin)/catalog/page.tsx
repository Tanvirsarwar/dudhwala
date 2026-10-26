'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api, download, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { taka } from '@/lib/format';
import { PRODUCT_STATUS, slugify, type Category } from '@/lib/catalog';
import { BulkPrice } from './bulk-price';
import { Badge, Empty, Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

interface ProductRow {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  status: string;
  category: { slug: string; nameBn: string };
  variants: { id: string; sku: string; labelBn: string; pricePoisha: number; status: string }[];
}

export default function CatalogPage() {
  const s = useSession();
  const { data, error, reload } = useLoad<ProductRow[]>('/admin/products');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (data ?? []).filter(
      (p) => (!status || p.status === status) && (!f || p.nameBn.toLowerCase().includes(f) || (p.nameEn ?? '').toLowerCase().includes(f) || p.variants.some((v) => v.sku.toLowerCase().includes(f))),
    );
  }, [data, q, status]);

  return (
    <>
      <PageTitle title="পণ্য ও দাম">
        {s.can('catalog.manage') ? (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => void download('/admin/variants/export.csv', 'dudhwala-variants.csv').then(() => setDlError(null), (e) => setDlError(errorText(e)))}>
              CSV নামান
            </button>
            {s.can('pricing.manage_global') ? (
              <button className="btn btn-ghost btn-sm" onClick={() => setBulkOpen(true)}>
                CSV থেকে দাম
              </button>
            ) : null}
            <button className="btn btn-ghost btn-sm" onClick={() => setCatOpen(true)}>
              ক্যাটাগরি
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setNewOpen(true)}>
              নতুন পণ্য
            </button>
          </>
        ) : null}
      </PageTitle>
      <p className="mb-3 text-sm text-muted">দাম সব আউটলেটে একই। খসড়া পণ্য গ্রাহকরা দেখতে পান না — প্রকাশ করার পরই দেখা যায়।</p>
      <Msg error={dlError} />
      <div className="mb-3 flex flex-wrap gap-2">
        <input className="field field-sm max-w-xs" aria-label="খুঁজুন" placeholder="নাম বা SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field field-sm w-auto" aria-label="অবস্থা" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">সব অবস্থা</option>
          {Object.entries(PRODUCT_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <Empty>কোনো পণ্য নেই।</Empty>
      ) : (
        <TableWrap label="পণ্য তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>পণ্য</th>
                <th>ক্যাটাগরি</th>
                <th>ভ্যারিয়েন্ট ও দাম</th>
                <th>অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/catalog/${p.id}`} className="font-semibold text-brand-600 underline">
                      {p.nameBn}
                    </Link>
                    {p.nameEn ? <div className="text-xs text-muted">{p.nameEn}</div> : null}
                  </td>
                  <td>{p.category.nameBn}</td>
                  <td className="text-sm">
                    {p.variants.map((v) => (
                      <div key={v.id} className={v.status === 'ARCHIVED' ? 'text-muted line-through' : ''}>
                        {v.labelBn} · <span className="font-latin">{taka(v.pricePoisha)}</span>
                      </div>
                    ))}
                  </td>
                  <td>
                    <Badge tone={PRODUCT_STATUS[p.status]?.tone}>{PRODUCT_STATUS[p.status]?.label ?? p.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {newOpen ? <NewProduct onClose={() => setNewOpen(false)} /> : null}
      {bulkOpen ? <BulkPrice onClose={() => setBulkOpen(false)} onDone={() => void reload()} /> : null}
      {catOpen ? <Categories onClose={() => setCatOpen(false)} /> : null}
    </>
  );
}

function NewProduct({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const cats = useLoad<Category[]>('/admin/categories');
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const a = useAction();
  const effectiveSlug = slug || slugify(nameEn);
  return (
    <Modal open title="নতুন পণ্য" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          let id = '';
          const ok = await a.run(async () => {
            id = (await api<{ id: string }>('/admin/products', { body: { nameBn, nameEn: nameEn || null, slug: effectiveSlug, categoryId } })).id;
          });
          if (ok) router.push(`/catalog/${id}`);
        }}
      >
        <Field label="নাম (বাংলা)" id="p-bn">
          <input id="p-bn" className="field" value={nameBn} onChange={(e) => setNameBn(e.target.value)} required />
        </Field>
        <Field label="নাম (English, ঐচ্ছিক)" id="p-en">
          <input id="p-en" className="field" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="URL স্লাগ" id="p-slug" hint="ছোট হাতের ইংরেজি অক্ষর, সংখ্যা ও হাইফেন; যেমন fresh-milk-1l।">
          <input id="p-slug" className="field font-latin" value={effectiveSlug} onChange={(e) => setSlug(e.target.value)} required aria-describedby="p-slug-hint" />
        </Field>
        <Field label="ক্যাটাগরি" id="p-cat">
          <select id="p-cat" className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
            <option value="">— বেছে নিন —</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameBn}
              </option>
            ))}
          </select>
        </Field>
        {cats.data && cats.data.length === 0 ? <p className="mb-3 text-sm text-warning">আগে একটি ক্যাটাগরি তৈরি করুন।</p> : null}
        <Msg error={a.error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            বাতিল
          </button>
          <button className="btn btn-primary" disabled={a.busy || !nameBn || !effectiveSlug || !categoryId}>
            তৈরি করুন (খসড়া)
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Categories({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useLoad<Category[]>('/admin/categories');
  const [nameBn, setNameBn] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [slug, setSlug] = useState('');
  const a = useAction();
  const effectiveSlug = slug || slugify(nameEn);
  return (
    <Modal open title="ক্যাটাগরি" onClose={onClose}>
      {!data ? (
        <Loading error={error} />
      ) : (
        <ul className="mb-4 max-h-60 space-y-1 overflow-y-auto text-sm">
          {data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span>
                {c.nameBn} <span className="font-latin text-xs text-muted">/{c.slug}</span> {c.active ? null : <Badge>নিষ্ক্রিয়</Badge>}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => void a.run(() => api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { active: !c.active } })).then((ok) => (ok ? reload() : undefined))}>
                {c.active ? 'নিষ্ক্রিয় করুন' : 'সক্রিয় করুন'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => api('/admin/categories', { body: { nameBn, nameEn: nameEn || null, slug: effectiveSlug } }), 'ক্যাটাগরি তৈরি হয়েছে').then((ok) => {
            if (ok) {
              setNameBn('');
              setNameEn('');
              setSlug('');
              void reload();
            }
          });
        }}
      >
        <h3 className="mb-2 font-semibold">নতুন ক্যাটাগরি</h3>
        <Field label="নাম (বাংলা)" id="c-bn">
          <input id="c-bn" className="field" value={nameBn} onChange={(e) => setNameBn(e.target.value)} required />
        </Field>
        <Field label="নাম (English)" id="c-en">
          <input id="c-en" className="field" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="URL স্লাগ" id="c-slug">
          <input id="c-slug" className="field font-latin" value={effectiveSlug} onChange={(e) => setSlug(e.target.value)} required />
        </Field>
        <Msg error={a.error} ok={a.ok} />
        <button className="btn btn-primary" disabled={a.busy || !nameBn || !effectiveSlug}>
          যোগ করুন
        </button>
      </form>
    </Modal>
  );
}
