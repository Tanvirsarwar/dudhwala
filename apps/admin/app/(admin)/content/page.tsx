'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction, useLoad } from '@/lib/use-load';
import { Badge, Field, Loading, Modal, Msg, PageTitle } from '@/components/ui';

interface Page {
  slug: string;
  titleBn: string;
  bodyBn: string;
  titleEn: string | null;
  bodyEn: string | null;
  published: boolean;
  version: number;
}
interface Banner {
  id: string;
  titleBn: string;
  altBn: string;
  linkUrl: string | null;
  active: boolean;
  sortOrder: number;
  imageUrl: string;
}
interface Collection {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string | null;
  active: boolean;
  sortOrder: number;
  items: { productId: string }[];
}
interface ProductLite {
  id: string;
  nameBn: string;
  status: string;
}

const PAGE_NAME: Record<string, string> = {
  about: 'আমাদের সম্পর্কে',
  faq: 'সাধারণ জিজ্ঞাসা',
  terms: 'শর্তাবলী',
  privacy: 'গোপনীয়তা নীতি',
  'refund-policy': 'রিফান্ড নীতি',
  'delivery-policy': 'ডেলিভারি নীতি',
  contact: 'যোগাযোগ',
};

type Tab = 'banners' | 'collections' | 'pages';

/** Storefront content. Nothing here is shown until it is approved/published. */
export default function ContentPage() {
  const [tab, setTab] = useState<Tab>('banners');
  return (
    <>
      <PageTitle title="ব্যানার ও পেজ" />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="কনটেন্ট">
        {(
          [
            ['banners', 'হোম ব্যানার'],
            ['collections', 'কালেকশন'],
            ['pages', 'তথ্য পেজ'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'banners' ? <Banners /> : tab === 'collections' ? <Collections /> : <Pages />}
    </>
  );
}

function Banners() {
  const { data, error, reload } = useLoad<Banner[]>('/admin/banners');
  const [file, setFile] = useState<File | null>(null);
  const [titleBn, setTitleBn] = useState('');
  const [altBn, setAltBn] = useState('');
  const a = useAction();
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div>
        <Msg error={a.error} ok={a.ok} />
        {!data ? (
          <Loading error={error} />
        ) : data.length === 0 ? (
          <p className="card p-4 text-sm text-muted">কোনো ব্যানার নেই — হোম পেজে ব্যানার অংশ লুকানো থাকবে।</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.map((b) => (
              <li key={b.id} className="card overflow-hidden">
                <img src={b.imageUrl} alt={b.altBn} className="aspect-[16/7] w-full bg-brand-100 object-cover" />
                <div className="flex items-center justify-between gap-2 p-3">
                  <span className="text-sm">
                    {b.titleBn} {b.active ? <Badge tone="good">দেখানো হচ্ছে</Badge> : <Badge>লুকানো</Badge>}
                  </span>
                  <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => void a.run(() => api(`/admin/banners/${b.id}`, { method: 'PATCH', body: { active: !b.active } })).then(() => reload())}>
                    {b.active ? 'লুকান' : 'অনুমোদন ও দেখান'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form
        className="card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!file) return;
          const fd = new FormData();
          fd.set('file', file);
          fd.set('titleBn', titleBn);
          fd.set('altBn', altBn);
          const form = e.currentTarget;
          void a.run(() => api('/admin/banners', { form: fd }), 'ব্যানার আপলোড হয়েছে (লুকানো অবস্থায়)').then(async (ok) => {
            if (ok) {
              form.reset();
              setFile(null);
              setTitleBn('');
              setAltBn('');
              await reload();
            }
          });
        }}
      >
        <h2 className="mb-2 font-semibold">নতুন ব্যানার</h2>
        <p className="mb-2 text-xs text-muted">শুধু ব্যবসার নিজের/লাইসেন্সকৃত ছবি। প্রস্তাবিত মাপ ১৬০০×৭০০।</p>
        <Field label="ছবি" id="b-file">
          <input id="b-file" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="শিরোনাম" id="b-title">
          <input id="b-title" className="field" value={titleBn} onChange={(e) => setTitleBn(e.target.value)} required />
        </Field>
        <Field label="ছবির বর্ণনা (alt)" id="b-alt">
          <input id="b-alt" className="field" value={altBn} onChange={(e) => setAltBn(e.target.value)} required />
        </Field>
        <button className="btn btn-primary btn-sm" disabled={!file || !titleBn || !altBn || a.busy}>
          আপলোড
        </button>
      </form>
    </div>
  );
}

function Collections() {
  const { data, error, reload } = useLoad<Collection[]>('/admin/collections');
  const products = useLoad<ProductLite[]>('/admin/products');
  const [editing, setEditing] = useState<Collection | 'new' | null>(null);
  return (
    <>
      <div className="mb-3 flex justify-end">
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          নতুন কালেকশন
        </button>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <p className="card p-4 text-sm text-muted">কোনো কালেকশন নেই।</p>
      ) : (
        <ul className="card divide-y divide-line">
          {data.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span>
                {c.titleBn} <span className="font-latin text-xs text-muted">/{c.slug}</span> · {c.items.length}টি পণ্য {c.active ? <Badge tone="good">চালু</Badge> : <Badge>বন্ধ</Badge>}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>
                সম্পাদনা
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <CollectionDialog collection={editing === 'new' ? null : editing} products={products.data ?? []} onClose={() => setEditing(null)} onDone={reload} /> : null}
    </>
  );
}

function CollectionDialog({ collection, products, onClose, onDone }: { collection: Collection | null; products: ProductLite[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [titleBn, setTitleBn] = useState(collection?.titleBn ?? '');
  const [slug, setSlug] = useState(collection?.slug ?? '');
  const [active, setActive] = useState(collection?.active ?? false);
  const [picked, setPicked] = useState<string[]>(collection?.items.map((i) => i.productId) ?? []);
  const a = useAction();
  return (
    <Modal open title={collection ? 'কালেকশন সম্পাদনা' : 'নতুন কালেকশন'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = { titleBn, slug, active, sortOrder: collection?.sortOrder ?? 0, productIds: picked };
          void a.run(() => (collection ? api(`/admin/collections/${collection.id}`, { method: 'PUT', body }) : api('/admin/collections', { body }))).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <Field label="শিরোনাম" id="k-title">
          <input id="k-title" className="field" value={titleBn} onChange={(e) => setTitleBn(e.target.value)} required />
        </Field>
        <Field label="স্লাগ" id="k-slug">
          <input id="k-slug" className="field font-latin" value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="[a-z0-9-]{2,60}" />
        </Field>
        <fieldset className="mb-3 max-h-56 overflow-y-auto">
          <legend className="label">পণ্য (ক্রম অনুযায়ী)</legend>
          {products
            .filter((p) => p.status !== 'ARCHIVED')
            .map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => setPicked((x) => (x.includes(p.id) ? x.filter((y) => y !== p.id) : [...x, p.id]))} /> {p.nameBn}
              </label>
            ))}
        </fieldset>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> হোম পেজে দেখান
        </label>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || !titleBn || !slug}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}

function Pages() {
  const { data, error, reload } = useLoad<Page[]>('/admin/pages');
  const [editing, setEditing] = useState<Page | null>(null);
  return (
    <>
      <p className="mb-3 text-sm text-muted">নীতিমালা (শর্তাবলী, রিফান্ড, গোপনীয়তা) ব্যবসার অনুমোদিত লেখা দিয়ে পূরণ করুন — আইনি পরামর্শ নিন। প্রকাশ না করা পর্যন্ত গ্রাহক দেখবেন না।</p>
      {!data ? (
        <Loading error={error} />
      ) : (
        <ul className="card divide-y divide-line">
          {data.map((p) => (
            <li key={p.slug} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span>
                {PAGE_NAME[p.slug] ?? p.slug} <span className="font-latin text-xs text-muted">/pages/{p.slug}</span> {p.published ? <Badge tone="good">প্রকাশিত v{p.version}</Badge> : <Badge tone="warn">{p.version ? 'অপ্রকাশিত' : 'খালি'}</Badge>}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(p)}>
                সম্পাদনা
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing ? <PageDialog page={editing} onClose={() => setEditing(null)} onDone={reload} /> : null}
    </>
  );
}

function PageDialog({ page, onClose, onDone }: { page: Page; onClose: () => void; onDone: () => Promise<void> }) {
  const [titleBn, setTitleBn] = useState(page.titleBn || PAGE_NAME[page.slug] || '');
  const [bodyBn, setBodyBn] = useState(page.bodyBn);
  const [published, setPublished] = useState(page.published);
  const a = useAction();
  return (
    <Modal open title={PAGE_NAME[page.slug] ?? page.slug} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() => api(`/admin/pages/${page.slug}`, { method: 'PUT', body: { titleBn, bodyBn, published } })).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <Field label="শিরোনাম" id="pg-title">
          <input id="pg-title" className="field" value={titleBn} onChange={(e) => setTitleBn(e.target.value)} required />
        </Field>
        <Field label="লেখা (সাধারণ টেক্সট; খালি লাইন দিয়ে অনুচ্ছেদ)" id="pg-body">
          <textarea id="pg-body" className="field" rows={12} value={bodyBn} onChange={(e) => setBodyBn(e.target.value)} required />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> প্রকাশ করুন
        </label>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || !titleBn.trim() || !bodyBn.trim()}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}
