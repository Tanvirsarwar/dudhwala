'use client';

import { useMemo, useState } from 'react';
import type { Category, ProductCardData } from '@/lib/api';
import { bnDigits } from '@/lib/format';
import { corrections, makeCatalog, rank } from '@/lib/catalog-search';
import { ProductGrid } from './product-card';
import { SearchBox } from './search-box';

type Sort = 'relevance' | 'price_asc' | 'price_desc';
const SORTS: [Sort, string][] = [
  ['relevance', 'প্রাসঙ্গিক'],
  ['price_asc', 'দাম: কম থেকে বেশি'],
  ['price_desc', 'দাম: বেশি থেকে কম'],
];

/**
 * Category bar + search + sort over the whole (small) catalogue, filtered in the browser. Category and search work
 * together; state is mirrored into the URL (?category=&q=&sort=) so links and refresh keep it.
 */
export function CatalogBrowser({ products, categories, initialQ = '', initialCategory = '', initialSort = 'relevance', withSearch = false, title }: { products: ProductCardData[]; categories: Category[]; initialQ?: string; initialCategory?: string; initialSort?: string; withSearch?: boolean; title?: string }) {
  const catalog = useMemo(() => makeCatalog(products, categories), [products, categories]);
  const [q, setQ] = useState(initialQ);
  const [cat, setCat] = useState(categories.some((c) => c.slug === initialCategory) ? initialCategory : '');
  const [sort, setSort] = useState<Sort>(SORTS.some(([k]) => k === initialSort) ? (initialSort as Sort) : 'relevance');

  const sync = (next: { q?: string; cat?: string; sort?: Sort }) => {
    const nq = next.q ?? q;
    const nc = next.cat ?? cat;
    const ns = next.sort ?? sort;
    const p = new URLSearchParams();
    if (nq.trim()) p.set('q', nq.trim());
    if (nc) p.set('category', nc);
    if (ns !== 'relevance') p.set('sort', ns);
    const s = p.toString();
    window.history.replaceState(null, '', s ? `?${s}` : window.location.pathname);
  };

  const matched = useMemo(() => (q.trim() ? rank(catalog, q) : products), [catalog, products, q]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of matched) m.set(p.categorySlug, (m.get(p.categorySlug) ?? 0) + 1);
    return m;
  }, [matched]);
  const shown = useMemo(() => {
    const list = cat ? matched.filter((p) => p.categorySlug === cat) : matched;
    if (sort === 'relevance') return list;
    return [...list].sort((a, b) => (sort === 'price_asc' ? a.fromPricePoisha - b.fromPricePoisha : b.fromPricePoisha - a.fromPricePoisha));
  }, [matched, cat, sort]);
  const fixes = useMemo(() => (q.trim() && matched.length === 0 ? corrections(catalog, q) : []), [catalog, q, matched.length]);
  const filtered = Boolean(q.trim() || cat || sort !== 'relevance');
  const clear = () => {
    setQ('');
    setCat('');
    setSort('relevance');
    sync({ q: '', cat: '', sort: 'relevance' });
  };
  const pick = (slug: string) => {
    setCat(slug);
    sync({ cat: slug });
  };

  return (
    <div>
      {withSearch && (
        <SearchBox
          className="mb-4"
          id="search-q"
          initial={q}
          inputClass="field pr-12"
          onQuery={(v) => {
            setQ(v);
            sync({ q: v });
          }}
        />
      )}
      <div className="mb-3 flex items-end justify-between gap-3">
        <h2 id="all-title" className="text-xl font-bold">
          {title ?? 'সব পণ্য'}
        </h2>
        <span className="text-sm text-muted" role="status">
          {bnDigits(shown.length)}টি পণ্য
        </span>
      </div>
      <nav aria-label="ক্যাটাগরি অনুযায়ী পণ্য" className="cat-bar">
        <button type="button" className="cat-pill" aria-pressed={cat === ''} onClick={() => pick('')}>
          সব পণ্য <b>{bnDigits(matched.length)}</b>
        </button>
        {categories.map((c) => (
          <button key={c.slug} type="button" className="cat-pill" aria-pressed={cat === c.slug} disabled={q.trim() !== '' && !counts.get(c.slug)} onClick={() => pick(c.slug)}>
            {c.nameBn} <b>{bnDigits(counts.get(c.slug) ?? 0)}</b>
          </button>
        ))}
      </nav>
      <div className="mb-3 mt-3 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="sort-sel" className="text-muted">
          সাজানো
        </label>
        <select
          id="sort-sel"
          className="field field-sm w-auto"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            sync({ sort: e.target.value as Sort });
          }}
        >
          {SORTS.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {filtered && (
          <button type="button" className="btn btn-ghost btn-compact" onClick={clear}>
            ফিল্টার মুছুন
          </button>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="card p-6 text-center">
          <p className="font-semibold">আপনার সার্চের সাথে মেলে এমন কোনো পণ্য নেই</p>
          {fixes.length > 0 && (
            <p className="mt-2 text-sm text-muted">
              আপনি কি বলতে চেয়েছেন:{' '}
              {fixes.map((f) => (
                <button key={f} type="button" className="mr-2 font-latin font-semibold text-accent-ink underline" onClick={() => {
                    setQ(f);
                    sync({ q: f });
                  }}>
                  {f}
                </button>
              ))}
            </p>
          )}
          <p className="mt-1 text-sm text-muted">ফিল্টার বদলে দেখুন বা সব পণ্য দেখুন।</p>
          <button type="button" className="btn btn-primary mt-3" onClick={clear}>
            ফিল্টার মুছুন
          </button>
        </div>
      ) : (
        <ProductGrid products={shown} />
      )}
    </div>
  );
}
