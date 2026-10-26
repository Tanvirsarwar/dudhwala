import { Inject, Injectable } from '@nestjs/common';
import { availableOnline } from '@dudhwala/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export type Availability = 'IN_STOCK' | 'OUT_OF_STOCK';

/**
 * Customer-facing availability. With an area: only outlets that serve that
 * area count. Without an area: any active online outlet counts, and the
 * response says the area has not been checked (final check happens at checkout).
 * Outlet identity is never exposed (APP_FLOW §2.3 step 6).
 */
@Injectable()
export class AvailabilityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async servingOutletIds(areaId: string | null): Promise<string[]> {
    const outlets = await this.prisma.outlet.findMany({
      where: {
        status: 'ACTIVE',
        acceptsOnlineOrders: true,
        ...(areaId ? { zoneRules: { some: { active: true, zone: { active: true, areas: { some: { areaId, area: { active: true } } } } } } } : {}),
      },
      select: { id: true },
    });
    return outlets.map((o) => o.id);
  }

  /** Per-variant availability (max units sellable at any single serving outlet). */
  async forVariants(variantIds: readonly string[], areaId: string | null): Promise<Map<string, { availability: Availability; maxQty: number }>> {
    const outletIds = await this.servingOutletIds(areaId);
    const rows = variantIds.length && outletIds.length
      ? await this.prisma.inventory.findMany({ where: { productVariantId: { in: [...variantIds] }, outletId: { in: outletIds }, isListed: true } })
      : [];
    const out = new Map<string, { availability: Availability; maxQty: number }>();
    for (const id of variantIds) out.set(id, { availability: 'OUT_OF_STOCK', maxQty: 0 });
    for (const r of rows) {
      const avail = availableOnline({ onHand: r.quantityOnHand, reserved: r.reservedQuantity, onlineBuffer: r.onlineBufferQty });
      const cur = out.get(r.productVariantId);
      if (cur && avail > cur.maxQty) out.set(r.productVariantId, { availability: avail > 0 ? 'IN_STOCK' : 'OUT_OF_STOCK', maxQty: avail });
    }
    return out;
  }
}
