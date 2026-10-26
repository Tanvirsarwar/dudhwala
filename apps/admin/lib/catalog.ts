export interface Category {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  parentId: string | null;
  active: boolean;
  sortOrder: number;
}

export const PRODUCT_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' }> = {
  ACTIVE: { label: 'প্রকাশিত', tone: 'good' },
  DRAFT: { label: 'খসড়া', tone: 'warn' },
  ARCHIVED: { label: 'আর্কাইভ', tone: 'neutral' },
};

/** Latin slug from an English name (Bangla names need a manually typed slug). */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
