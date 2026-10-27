import Link from 'next/link';
import type { ProductCardData } from '@/lib/api';
import { taka } from '@/lib/format';
import { ProductImage } from './product-image';
import { QuickAdd } from './quick-add';
import { Tilt } from './pointer-motion';

export function ProductCard({ p, index = 0 }: { p: ProductCardData; index?: number }) {
  const multi = p.variants.length > 1;
  const labels = p.variants.map((v) => v.labelBn).filter(Boolean).join(' · ');
  const single = !multi && p.inStock && p.variants[0]?.availability === 'IN_STOCK' ? p.variants[0].id : null;
  const offer = p.variants.some((v) => v.compareAtPoisha && v.pricePoisha !== null && v.compareAtPoisha > v.pricePoisha);
  return (
    <li className="reveal" style={{ ['--i' as string]: Math.min(index, 8) }}>
      <Tilt max={4} className="h-full">
      <div className="card card-lift flex h-full flex-col overflow-hidden">
      <Link href={`/p/${p.slug}`} className="group flex flex-1 flex-col">
        <div className={`relative aspect-[5/4] overflow-hidden bg-white ${p.inStock ? '' : 'grayscale'}`}>
          <ProductImage src={p.image?.url ?? null} alt={p.image?.altBn ?? p.nameBn} />
          {!p.inStock && <span className="absolute left-2 top-2 rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-danger shadow">স্টকে নেই</span>}
          {p.inStock && offer && <span className="absolute left-2 top-2 rounded-full bg-accent-500 px-2.5 py-0.5 text-xs font-bold text-brand-900 shadow">অফার</span>}
        </div>
        <div className="flex flex-1 flex-col gap-0.5 p-2.5 pb-1.5">
          <h3 className="line-clamp-2 text-[0.9375rem] font-semibold leading-snug transition-colors group-hover:text-brand-600">{p.nameBn}</h3>
          {p.nameEn && p.nameEn !== p.nameBn && <p className="font-latin text-xs text-muted">{p.nameEn}</p>}
          {p.fromPricePoisha === null ? (
            <p className="price-pending mt-auto pt-0.5">{taka(null)}</p>
          ) : (
            <p className="mt-auto pt-0.5 text-base font-bold text-brand-700">
              {multi && <span className="text-sm font-normal text-muted">শুরু </span>}
              {taka(p.fromPricePoisha)}
            </p>
          )}
          {labels && <p className="line-clamp-1 text-xs text-muted">{labels}</p>}
        </div>
      </Link>
      <div className="p-2.5 pt-0.5">{p.inStock ? <QuickAdd slug={p.slug} variantId={single} name={p.nameBn} /> : <span className="btn btn-ghost btn-compact w-full" aria-disabled="true">স্টকে নেই</span>}</div>
      </div>
      </Tilt>
    </li>
  );
}

export function ProductGrid({ products }: { products: ProductCardData[] }) {
  if (products.length === 0)
    return (
      <div className="card p-8 text-center">
        <p className="font-semibold">এখানে এখনো কোনো পণ্য নেই।</p>
        <p className="mt-1 text-sm text-muted">অন্য ক্যাটাগরি দেখুন বা পরে আবার আসুন।</p>
      </div>
    );
  return (
    <ul className="product-grid">
      {products.map((p, i) => (
        <ProductCard key={p.id} p={p} index={i} />
      ))}
    </ul>
  );
}
