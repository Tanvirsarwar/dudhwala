import Link from 'next/link';
import type { ProductList } from '@/lib/api';
import { bnDigits } from '@/lib/format';
import { ProductGrid } from './product-card';

const SORTS = [
  ['relevance', 'প্রাসঙ্গিক'],
  ['newest', 'নতুন'],
  ['price_asc', 'দাম: কম থেকে বেশি'],
  ['price_desc', 'দাম: বেশি থেকে কম'],
] as const;

/** Sort/filter/pagination are plain links and GET forms: work without JavaScript. */
export function Listing({ list, basePath, params }: { list: ProductList; basePath: string; params: Record<string, string | undefined> }) {
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const pages = Math.max(1, Math.ceil(list.total / list.limit));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">{bnDigits(list.total)}টি পণ্য</span>
        <span className="mx-1 text-line">|</span>
        {SORTS.map(([k, label]) => (
          <Link key={k} href={href({ sort: k, page: undefined })} aria-current={(params.sort ?? 'relevance') === k ? 'true' : undefined} className={`rounded-full px-3 py-1 ${(params.sort ?? 'relevance') === k ? 'bg-brand-600 text-on-brand' : 'bg-surface hover:bg-brand-100'}`}>
            {label}
          </Link>
        ))}
        <Link href={href({ inStock: params.inStock ? undefined : 'true', page: undefined })} aria-pressed={params.inStock ? 'true' : 'false'} className={`rounded-full px-3 py-1 ${params.inStock ? 'bg-accent-500 text-brand-900' : 'bg-surface hover:bg-brand-100'}`}>
          শুধু স্টকে আছে
        </Link>
      </div>
      <ProductGrid products={list.data} />
      {pages > 1 && (
        <nav className="mt-6 flex justify-center gap-2" aria-label="পাতা">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={href({ page: String(n) })} aria-current={list.page === n ? 'page' : undefined} className={`btn ${list.page === n ? 'btn-primary' : 'btn-ghost'} w-11 px-0`}>
              {bnDigits(n)}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

export function listingQuery(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === 'string' && v.length <= 80 ? v : undefined;
  };
  const sort = ['relevance', 'newest', 'price_asc', 'price_desc'].includes(one('sort') ?? '') ? one('sort') : undefined;
  const page = /^\d{1,3}$/.test(one('page') ?? '') ? one('page') : undefined;
  const inStock = one('inStock') === 'true' ? 'true' : undefined;
  return { q: one('q'), sort, page, inStock };
}
