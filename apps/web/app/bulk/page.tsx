import type { Metadata } from 'next';
import { fetchAllProducts, serverGet, type Category } from '@/lib/api';
import { BulkBuilder } from '@/components/bulk-builder';

export const metadata: Metadata = { title: 'শোরুম থেকে অর্ডার' };

/** Bulk order builder : pick many products with quantities, then continue to the demo checkout. */
export default async function BulkPage() {
  const [products, categories] = await Promise.all([fetchAllProducts(serverGet), serverGet<Category[]>('/catalog/categories')]);
  return <BulkBuilder products={products} categories={categories ?? []} />;
}
