import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchAllProducts, serverGet, type Category } from '@/lib/api';
import { DEMO_BRANDING } from '@/components/developer-credit';
import { BulkBuilder } from '@/components/bulk-builder';

export const metadata: Metadata = { title: 'বাল্ক অর্ডার' };

/** Bulk order builder (demo build): pick many products with quantities, then continue to the demo checkout. */
export default async function BulkPage() {
  if (!DEMO_BRANDING) notFound();
  const [products, categories] = await Promise.all([fetchAllProducts(serverGet), serverGet<Category[]>('/catalog/categories')]);
  return <BulkBuilder products={products} categories={categories ?? []} />;
}
