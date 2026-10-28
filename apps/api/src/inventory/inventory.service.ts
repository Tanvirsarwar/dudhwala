import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { newId } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { MovementType } from '../generated/prisma/client.js';

export interface StockLine {
  variantId: string;
  qty: number;
}
export type StockActor = { userId: string } | { system: string };

/**
 * Stock for variants that are counted (`trackStock`). Every change is one guarded
 * SQL statement, so two concurrent orders can never reserve the same unit, plus an
 * append-only ledger row. The ledger is also how reservations are released or
 * committed later: the amount an order still holds is the sum of its movements.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  private async log(
    tx: Tx,
    inv: { id: string; outletId: string; variantId: string; onHand: number; reserved: number },
    type: MovementType,
    delta: { onHand: number; reserved: number },
    actor: StockActor,
    extra: { orderId?: string | null; reason?: string | null } = {},
  ): Promise<void> {
    await tx.stockMovement.create({
      data: {
        id: newId(),
        inventoryId: inv.id,
        outletId: inv.outletId,
        productVariantId: inv.variantId,
        type,
        qtyDeltaOnHand: delta.onHand,
        qtyDeltaReserved: delta.reserved,
        onHandAfter: inv.onHand,
        reservedAfter: inv.reserved,
        reason: extra.reason ?? null,
        orderId: extra.orderId ?? null,
        actorUserId: 'userId' in actor ? actor.userId : null,
        actorSystem: 'system' in actor ? actor.system : null,
        createdAt: this.clock.now(),
      },
    });
  }

  /** Admin sets the counted quantity at an outlet. Cannot go below what open orders hold. */
  async setStock(tx: Tx, outletId: string, variantId: string, quantity: number, actor: StockActor, reason: string): Promise<void> {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new AppError('VALIDATION_FAILED', 'Stock must be a whole number from 0 to 1,000,000');
    const cur = (
      await tx.$queryRaw<{ id: string; on_hand: number; reserved: number }[]>`
        SELECT id, quantity_on_hand AS on_hand, reserved_quantity AS reserved FROM inventory
        WHERE outlet_id = ${outletId}::uuid AND product_variant_id = ${variantId}::uuid FOR UPDATE`
    )[0];
    if (cur && cur.reserved > quantity) throw new AppError('CONFLICT', 'Open orders already hold more than this quantity');
    const id = cur?.id ?? newId();
    if (cur) await tx.inventory.update({ where: { id }, data: { quantityOnHand: quantity } });
    else await tx.inventory.create({ data: { id, outletId, productVariantId: variantId, quantityOnHand: quantity, reservedQuantity: 0 } });
    await this.log(tx, { id, outletId, variantId, onHand: quantity, reserved: cur?.reserved ?? 0 }, 'SET', { onHand: quantity - (cur?.on_hand ?? 0), reserved: 0 }, actor, { reason });
  }

  /** Reserves every line at the outlet or throws OUT_OF_STOCK naming the first short variant. Caller passes tracked variants only. */
  async reserve(tx: Tx, outletId: string, lines: StockLine[], orderId: string, actor: StockActor): Promise<void> {
    for (const l of [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId))) {
      const rows = await tx.$queryRaw<{ id: string; on_hand: number; reserved: number }[]>`
        UPDATE inventory SET reserved_quantity = reserved_quantity + ${l.qty}, updated_at = ${this.clock.now()}
        WHERE outlet_id = ${outletId}::uuid AND product_variant_id = ${l.variantId}::uuid
          AND quantity_on_hand - reserved_quantity >= ${l.qty}
        RETURNING id, quantity_on_hand AS on_hand, reserved_quantity AS reserved`;
      const r = rows[0];
      if (!r) throw new AppError('OUT_OF_STOCK', 'কিছু পণ্য পর্যাপ্ত নেই', { variantId: l.variantId });
      await this.log(tx, { id: r.id, outletId, variantId: l.variantId, onHand: r.on_hand, reserved: r.reserved }, 'RESERVE', { onHand: 0, reserved: l.qty }, actor, { orderId });
    }
  }

  private async held(tx: Tx, orderId: string) {
    return tx.$queryRaw<{ inventory_id: string; outlet_id: string; variant_id: string; held: number }[]>`
      SELECT inventory_id, outlet_id, product_variant_id AS variant_id, SUM(qty_delta_reserved)::int AS held
      FROM stock_movement WHERE order_id = ${orderId}::uuid
      GROUP BY inventory_id, outlet_id, product_variant_id HAVING SUM(qty_delta_reserved) > 0`;
  }

  /** Gives back everything the order still holds (cancel / payment timeout). Safe to call twice. */
  async release(tx: Tx, orderId: string, actor: StockActor, reason: string): Promise<void> {
    for (const h of await this.held(tx, orderId)) {
      const rows = await tx.$queryRaw<{ on_hand: number; reserved: number }[]>`
        UPDATE inventory SET reserved_quantity = reserved_quantity - ${h.held}, updated_at = ${this.clock.now()}
        WHERE id = ${h.inventory_id}::uuid RETURNING quantity_on_hand AS on_hand, reserved_quantity AS reserved`;
      const r = rows[0];
      if (r) await this.log(tx, { id: h.inventory_id, outletId: h.outlet_id, variantId: h.variant_id, onHand: r.on_hand, reserved: r.reserved }, 'RELEASE', { onHand: 0, reserved: -h.held }, actor, { orderId, reason });
    }
  }

  /** Order fulfilled: the reserved units leave the shelf. */
  async commit(tx: Tx, orderId: string, actor: StockActor): Promise<void> {
    for (const h of await this.held(tx, orderId)) {
      const rows = await tx.$queryRaw<{ on_hand: number; reserved: number }[]>`
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - ${h.held}, reserved_quantity = reserved_quantity - ${h.held}, updated_at = ${this.clock.now()}
        WHERE id = ${h.inventory_id}::uuid RETURNING quantity_on_hand AS on_hand, reserved_quantity AS reserved`;
      const r = rows[0];
      if (r) await this.log(tx, { id: h.inventory_id, outletId: h.outlet_id, variantId: h.variant_id, onHand: r.on_hand, reserved: r.reserved }, 'COMMIT_SALE', { onHand: -h.held, reserved: -h.held }, actor, { orderId });
    }
  }

  /** Units that can still be ordered at each outlet for the given variants (counted variants only). */
  async availableAt(tx: Tx, variantIds: string[]): Promise<Map<string, Map<string, number>>> {
    const rows = await tx.inventory.findMany({ where: { productVariantId: { in: variantIds }, outlet: { status: 'ACTIVE' } } });
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = out.get(r.productVariantId) ?? new Map<string, number>();
      m.set(r.outletId, r.quantityOnHand - r.reservedQuantity);
      out.set(r.productVariantId, m);
    }
    return out;
  }
}
