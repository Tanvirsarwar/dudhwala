import Link from 'next/link';
import type { ProductCardData } from '@/lib/api';
import { taka } from '@/lib/format';
import { ProductImage } from './product-image';

export function ProductCard({ p }: { p: ProductCardData }) {
  const multi = p.variants.length > 1;
  return (
    <li className="card flex flex-col overflow-hidden">
      <Link href={`/p/${p.slug}`} className="group flex flex-1 flex-col">
        <div className={`relative aspect-square bg-white ${p.inStock ? '' : 'grayscale'}`}>
          <ProductImage src={p.image?.url ?? null} alt={p.image?.altBn ?? p.nameBn} />
          {!p.inStock && <span className="absolute left-2 top-2 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-danger shadow">স্টকে নেই</span>}
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3">
          <h3 className="line-clamp-2 font-semibold leading-snug group-hover:text-brand-600">{p.nameBn}</h3>
          {p.nameEn && p.nameEn !== p.nameBn && <p className="font-latin text-xs text-muted">{p.nameEn}</p>}
          <p className="mt-auto pt-1 text-lg font-bold text-brand-700">
            {multi && <span className="text-sm font-normal text-muted">শুরু </span>}
            {taka(p.fromPricePoisha)}
          </p>
          <p className="text-xs text-muted">{p.variants.map((v) => v.labelBn).join(' · ')}</p>
        </div>
      </Link>
    </li>
  );
}

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0) return <p className="rounded-xl bg-white p-6 text-center text-muted">এখানে এখনো কোনো পণ্য নেই।</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} p={p} />
      ))}
    </ul>
  );
}
