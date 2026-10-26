import type { Metadata } from 'next';
import { serverGet, type ProductList } from '@/lib/api';
import { Listing, listingQuery } from '@/components/listing';
import { SearchIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'খুঁজুন' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SearchPage({ searchParams }: Props) {
  const q = listingQuery(await searchParams);
  const qs = new URLSearchParams({ ...(q.q ? { q: q.q } : {}), ...(q.sort ? { sort: q.sort } : {}), ...(q.page ? { page: q.page } : {}), ...(q.inStock ? { inStock: q.inStock } : {}) });
  const list = await serverGet<ProductList>(`/catalog/products?${qs}`, 15);
  return (
    <div className="pt-6">
      <form action="/search" role="search" className="relative mb-5">
        <label htmlFor="search-q" className="label">
          পণ্য খুঁজুন
        </label>
        <input id="search-q" name="q" type="search" defaultValue={q.q ?? ''} className="field pr-12" placeholder="যেমন: দই, ঘি, Cake" />
        <button type="submit" className="absolute bottom-1 right-1 inline-flex h-9 w-9 items-center justify-center text-brand-600" aria-label="খুঁজুন">
          <SearchIcon />
        </button>
      </form>
      <h1 className="mb-3 text-xl font-bold">{q.q ? `“${q.q}” এর ফলাফল` : 'সব পণ্য'}</h1>
      <Listing list={list ?? { data: [], page: 1, limit: 24, total: 0 }} basePath="/search" params={{ q: q.q, sort: q.sort, inStock: q.inStock }} />
    </div>
  );
}
