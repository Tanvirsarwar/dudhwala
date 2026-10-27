import type { Metadata } from 'next';
import { serverGet, type Category, type ProductList } from '@/lib/api';
import { CatalogBrowser } from '@/components/catalog-browser';

export const metadata: Metadata = { title: 'খুঁজুন' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v.slice(0, 80) : '');

/** Typo-tolerant search over the whole catalogue (runs in the browser; the catalogue is small). */
export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const [list, categories] = await Promise.all([serverGet<ProductList>('/catalog/products?limit=48&sort=newest', 15), serverGet<Category[]>('/catalog/categories')]);
  return (
    <div className="pt-6">
      <CatalogBrowser withSearch title="খুঁজুন" products={list?.data ?? []} categories={categories ?? []} initialQ={one(sp.q)} initialCategory={one(sp.category)} initialSort={one(sp.sort)} />
    </div>
  );
}
