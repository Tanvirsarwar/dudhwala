import type { OuterCityStatus } from '@dudhwala/shared';

export interface Variant {
  id: string;
  labelBn: string;
  pricePoisha: number | null;
  compareAtPoisha: number | null;
  stock: number | null;
  maxQty: number;
}
export interface AdminProduct {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  categorySlug: string;
  categoryNameBn: string;
  active: boolean;
  nameVerified: boolean;
  outerCityStatus: OuterCityStatus | null;
  image: string | null;
  content: Record<'descriptionBn' | 'ingredientsBn' | 'allergensBn' | 'storageBn' | 'shelfLifeBn', string | null>;
  variants: Variant[];
}
export interface AdminCategory {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  active: boolean;
  sortOrder: number;
  productCount?: number;
}
