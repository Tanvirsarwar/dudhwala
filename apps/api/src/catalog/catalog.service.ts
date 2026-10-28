import { Inject, Injectable } from '@nestjs/common';
import type { OuterCityStatus as SharedOuterCity } from '@dudhwala/shared';
import { MediaService } from '../media/media.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { OuterCityStatus, Prisma } from '../generated/prisma/client.js';

type ProductRow = Prisma.ProductGetPayload<{ include: { category: true; variants: true } }>;
type VariantRow = ProductRow['variants'][number];

export const outerToApi = (s: OuterCityStatus | null): SharedOuterCity | null => (s ? (s.toLowerCase() as SharedOuterCity) : null);
export const outerFromApi = (s: string | null): OuterCityStatus | null => (s ? (s.toUpperCase() as OuterCityStatus) : null);

/**
 * Read models for the storefront and admin. Stock is exposed as availability only to customers
 * (never counts); the admin sees counts at the dispatch outlet.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  imageUrl(p: { imageKey: string | null; imageVersion: number }): string | null {
    return p.imageKey ? `${this.media.url(p.imageKey)}?v=${p.imageVersion}` : null;
  }

  /** variantId -> best available units across active outlets (Infinity when stock is not counted). */
  async availability(tx: Tx, variants: VariantRow[]): Promise<Map<string, number>> {
    const counted = variants.filter((v) => v.trackStock).map((v) => v.id);
    const per = await this.inventory.availableAt(tx, counted);
    const out = new Map<string, number>();
    for (const v of variants) {
      if (!v.trackStock) out.set(v.id, Number.POSITIVE_INFINITY);
      else out.set(v.id, Math.max(0, ...(per.get(v.id)?.values() ?? [0])));
    }
    return out;
  }

  /** Active products in active categories, for customers. */
  liveWhere(extra: Prisma.ProductWhereInput = {}): Prisma.ProductWhereInput {
    return { active: true, category: { active: true }, ...extra };
  }

  async cards(tx: Tx, rows: ProductRow[]) {
    const avail = await this.availability(tx, rows.flatMap((r) => r.variants));
    return rows.map((p) => {
      const variants = [...p.variants].sort((a, b) => a.sortOrder - b.sortOrder);
      const prices = variants.map((v) => v.pricePoisha).filter((n): n is number => n !== null);
      const image = this.imageUrl(p);
      return {
        id: p.id,
        slug: p.slug,
        nameBn: p.nameBn,
        nameEn: p.nameEn,
        categorySlug: p.category.slug,
        image: image ? { url: image, altBn: p.nameBn } : null,
        outerCityStatus: outerToApi(p.outerCityStatus),
        fromPricePoisha: prices.length ? Math.min(...prices) : null,
        inStock: variants.some((v) => (avail.get(v.id) ?? 0) > 0),
        variants: variants.map((v) => ({
          id: v.id,
          labelBn: v.labelBn,
          labelEn: v.labelEn,
          pricePoisha: v.pricePoisha,
          compareAtPoisha: v.compareAtPoisha,
          availability: (avail.get(v.id) ?? 0) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
        })),
      };
    });
  }

  async detail(tx: Tx, p: ProductRow) {
    const avail = await this.availability(tx, p.variants);
    const image = this.imageUrl(p);
    const content = Object.fromEntries(
      Object.entries({ descriptionBn: p.descriptionBn, ingredientsBn: p.ingredientsBn, allergensBn: p.allergensBn, storageBn: p.storageBn, shelfLifeBn: p.shelfLifeBn }).filter(([, v]) => v),
    );
    return {
      id: p.id,
      slug: p.slug,
      nameBn: p.nameBn,
      nameEn: p.nameEn,
      outerCityStatus: outerToApi(p.outerCityStatus),
      category: { slug: p.category.slug, nameBn: p.category.nameBn, nameEn: p.category.nameEn },
      images: image ? [{ url: image, altBn: p.nameBn, altEn: p.nameEn, width: p.imageWidth ?? 800, height: p.imageHeight ?? 800 }] : [],
      content,
      variants: [...p.variants]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => ({
          id: v.id,
          labelBn: v.labelBn,
          labelEn: v.labelEn,
          pricePoisha: v.pricePoisha,
          compareAtPoisha: v.compareAtPoisha,
          availability: (avail.get(v.id) ?? 0) > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK',
          maxQty: Math.min(v.maxQty, Number.isFinite(avail.get(v.id)) ? (avail.get(v.id) as number) : v.maxQty),
        })),
    };
  }

  /** Admin view of a product: counts at the dispatch outlet, per-outlet stock, no customer-facing simplifications. */
  async adminView(tx: Tx, p: ProductRow, dispatchOutletId: string | null) {
    const inv = await tx.inventory.findMany({ where: { productVariantId: { in: p.variants.map((v) => v.id) } } });
    return {
      id: p.id,
      slug: p.slug,
      nameBn: p.nameBn,
      nameEn: p.nameEn,
      categorySlug: p.category.slug,
      categoryNameBn: p.category.nameBn,
      active: p.active,
      nameVerified: p.nameVerified,
      outerCityStatus: outerToApi(p.outerCityStatus),
      image: this.imageUrl(p),
      content: { descriptionBn: p.descriptionBn, ingredientsBn: p.ingredientsBn, allergensBn: p.allergensBn, storageBn: p.storageBn, shelfLifeBn: p.shelfLifeBn },
      variants: [...p.variants]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((v) => {
          const rows = inv.filter((i) => i.productVariantId === v.id);
          const at = dispatchOutletId ? rows.find((i) => i.outletId === dispatchOutletId) : undefined;
          return {
            id: v.id,
            labelBn: v.labelBn,
            pricePoisha: v.pricePoisha,
            compareAtPoisha: v.compareAtPoisha,
            /** Units at the dispatch outlet; null = stock not counted for this variant. */
            stock: v.trackStock ? (at ? at.quantityOnHand - at.reservedQuantity : 0) : null,
            maxQty: v.maxQty,
            stockByOutlet: rows.map((i) => ({ outletId: i.outletId, onHand: i.quantityOnHand, reserved: i.reservedQuantity })),
          };
        }),
      createdAt: p.createdAt,
    };
  }
}
