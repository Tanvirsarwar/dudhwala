import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { serverGet } from '@/lib/api';
import { ProductGallery } from '@/components/product-gallery';
import { AddToCart } from './add-to-cart';

export interface ProductDetail {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  category: { slug: string; nameBn: string };
  images: { url: string; altBn: string }[];
  content: Partial<Record<'descriptionBn' | 'ingredientsBn' | 'allergensBn' | 'storageBn' | 'shelfLifeBn', string>>;
  variants: { id: string; labelBn: string; pricePoisha: number; compareAtPoisha: number | null; availability: 'IN_STOCK' | 'OUT_OF_STOCK'; maxQty: number }[];
}

type Props = { params: Promise<{ slug: string }> };

const getProduct = (slug: string) => (/^[a-z0-9-]{1,120}$/.test(slug) ? serverGet<ProductDetail>(`/catalog/products/${slug}`) : Promise.resolve(null));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  return { title: p?.nameBn ?? 'পণ্য' };
}

/** Optional sections render only when the business supplied them (PRD FR-2). */
const SECTIONS: [keyof ProductDetail['content'], string][] = [
  ['descriptionBn', 'বিবরণ'],
  ['ingredientsBn', 'উপাদান'],
  ['allergensBn', 'অ্যালার্জি সংক্রান্ত তথ্য'],
  ['storageBn', 'সংরক্ষণের নিয়ম'],
  ['shelfLifeBn', 'মেয়াদ'],
];

export default async function ProductPage({ params }: Props) {
  const p = await getProduct((await params).slug);
  if (!p) notFound();
  return (
    <article className="pt-6">
      <nav aria-label="ব্রেডক্রাম্ব" className="mb-3 text-sm text-muted">
        <Link href="/" className="hover:underline">
          প্রথম পাতা
        </Link>{' '}
        /{' '}
        <Link href={`/c/${p.category.slug}`} className="hover:underline">
          {p.category.nameBn}
        </Link>
      </nav>
      <div className="grid gap-6 md:grid-cols-2">
        <ProductGallery images={p.images} name={p.nameBn} />
        <div>
          <h1 className="text-2xl font-bold leading-snug md:text-3xl">{p.nameBn}</h1>
          {p.nameEn && p.nameEn !== p.nameBn && <p className="font-latin text-muted">{p.nameEn}</p>}
          <AddToCart slug={p.slug} variants={p.variants} />
        </div>
      </div>
      {SECTIONS.some(([k]) => p.content[k]) && (
        <div className="mt-8 grid gap-4">
          {SECTIONS.filter(([k]) => p.content[k]).map(([k, title]) => (
            <section key={k} className="card p-5">
              <h2 className="mb-2 text-lg font-bold">{title}</h2>
              <p className="whitespace-pre-line">{p.content[k]}</p>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
