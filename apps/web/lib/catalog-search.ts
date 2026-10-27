import { buildSearchIndex, searchIndex, suggestCorrections, type SearchIndex } from '@dudhwala/shared';
import { api, fetchAllProducts, type Category, type ProductCardData } from './api';

/** Complementary categories for "You may also like" (same-category products always come first). */
export const COMPLEMENTS: Record<string, string[]> = {
  'dairy-sweets': ['doi-dairy', 'bakery'],
  'doi-dairy': ['dairy-sweets', 'bakery'],
  bakery: ['dairy-sweets', 'doi-dairy'],
};

export interface Catalog {
  products: ProductCardData[];
  categories: Category[];
  index: SearchIndex<ProductCardData>;
}

export function makeCatalog(products: ProductCardData[], categories: Category[]): Catalog {
  const cat = new Map(categories.map((c) => [c.slug, c]));
  const index = buildSearchIndex(
    products.map((p) => {
      const c = cat.get(p.categorySlug);
      return { item: p, primary: [p.nameBn, p.nameEn ?? ''], secondary: [c?.nameBn ?? '', c?.nameEn ?? '', p.categorySlug.replace(/-/g, ' ')] };
    }),
  );
  return { products, categories, index };
}

export const rank = (c: Catalog, q: string) => searchIndex(c.index, q).map((h) => h.item);
export const corrections = (c: Catalog, q: string) => suggestCorrections(c.index, q);

let loading: Promise<Catalog> | null = null;
/** Browser-side catalogue for search suggestions; loaded once. */
export function loadCatalog(): Promise<Catalog> {
  loading ??= Promise.all([fetchAllProducts((p) => api(p)), api<Category[]>('/catalog/categories')])
    .then(([l, c]) => makeCatalog(l, c))
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export function related(all: ProductCardData[], slug: string, categorySlug: string, max = 6): ProductCardData[] {
  const out: ProductCardData[] = [];
  const seen = new Set([slug]);
  const take = (list: ProductCardData[]) => {
    for (const p of list) {
      if (out.length >= max || seen.has(p.slug)) continue;
      seen.add(p.slug);
      out.push(p);
    }
  };
  take(all.filter((p) => p.categorySlug === categorySlug).slice(0, 4));
  for (const c of COMPLEMENTS[categorySlug] ?? []) take(all.filter((p) => p.categorySlug === c).slice(0, 2));
  return out;
}
