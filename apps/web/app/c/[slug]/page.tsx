import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet, type Category, type ProductList } from '@/lib/api';
import { Listing, listingQuery } from '@/components/listing';

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function category(slug: string) {
  const cats = await serverGet<Category[]>('/catalog/categories');
  return cats?.find((c) => c.slug === slug) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await category((await params).slug);
  return { title: c?.nameBn ?? 'ক্যাটাগরি' };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const c = await category(slug);
  if (!c) notFound();
  const q = listingQuery(await searchParams);
  const qs = new URLSearchParams({ category: slug, ...(q.sort ? { sort: q.sort } : {}), ...(q.page ? { page: q.page } : {}), ...(q.inStock ? { inStock: q.inStock } : {}) });
  const list = await serverGet<ProductList>(`/catalog/products?${qs}`);
  return (
    <div className="pt-6">
      <h1 className="mb-4 text-2xl font-bold">{c.nameBn}</h1>
      <Listing list={list ?? { data: [], page: 1, limit: 24, total: 0 }} basePath={`/c/${slug}`} params={{ sort: q.sort, inStock: q.inStock }} />
    </div>
  );
}
