'use client';

import { useEffect, useState } from 'react';
import type { ProductCardData } from '@/lib/api';
import { related } from '@/lib/catalog-search';
import { useEligibility } from '@/lib/demo/zone';
import { ProductCard } from './product-card';

const KEY = 'dw.recent';
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** "You may also like" (same category, then complementary categories) and "Recently viewed", below a product. */
export function ProductExtras({ all: everything, slug, categorySlug }: { all: ProductCardData[]; slug: string; categorySlug: string }) {
  const eligible = useEligibility();
  const all = everything.filter((p) => p.slug === slug || eligible(p).eligible);
  const [recent, setRecent] = useState<ProductCardData[]>([]);
  const likes = related(all, slug, categorySlug, 6);

  useEffect(() => {
    const prev = readRecent().filter((s) => s !== slug);
    try {
      window.localStorage.setItem(KEY, JSON.stringify([slug, ...prev].slice(0, 12)));
    } catch {
      /* storage blocked: recently viewed simply stays empty */
    }
    const bySlug = new Map(all.map((p) => [p.slug, p]));
    const shownAsLikes = new Set(likes.map((p) => p.slug));
    setRecent(prev.map((s) => bySlug.get(s)).filter((p): p is ProductCardData => Boolean(p) && !shownAsLikes.has((p as ProductCardData).slug)).slice(0, 6));
  }, [slug]);

  return (
    <>
      {likes.length > 0 && (
        <section className="mt-8" aria-labelledby="like-title">
          <h2 id="like-title" className="h-dots mb-3 text-xl font-bold">
            আপনার আরও পছন্দ হতে পারে
          </h2>
          <ul className="related-list">
            {likes.map((p, i) => (
              <ProductCard key={p.id} p={p} index={i} />
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-title">
          <h2 id="recent-title" className="h-dots mb-3 text-xl font-bold">
            সম্প্রতি দেখা পণ্য
          </h2>
          <ul className="related-list">
            {recent.map((p, i) => (
              <ProductCard key={p.id} p={p} index={i} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
