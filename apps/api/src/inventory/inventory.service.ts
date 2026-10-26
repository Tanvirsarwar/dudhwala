import { Inject, Injectable } from '@nestjs/common';
import { MANUAL_MOVEMENT_TYPES, movementDelta, type MovementType } from '@dudhwala/shared';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';

export interface Actor {
  userId?: string | null;
  system?: string | null;
}

export interface MovementInput {
  outletId: string;
  variantId: string;
  type: MovementType;
  qty: number;
  reason?: string | null;
  orderId?: string | null;
  transferId?: string | null;
  /** Internal re-reservation of goods already set aside for an order (returned after failed delivery). */
  ignoreBuffer?: boolean;
}

interface InventoryRow {
  id: string;
  quantity_on_hand: number;
  reserved_quantity: number;
}

/**
 * Outlet-scoped stock changes (TRD §5.2). Every change is a single conditional
 * UPDATE so concurrent requests cannot oversell; the DB CHECK constraints are
 * the final guard. Each change writes a stock_movement row in the same transaction.
 */
@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Applies one movement inside `tx`. Throws OUT_OF_STOCK / CONFLICT when the guarded update matches no row. */
  async apply(tx: Tx, m: MovementInput, actor: Actor): Promise<{ onHand: number; reserved: number }> {
    if (MANUAL_MOVEMENT_TYPES.has(m.type) && !m.reason?.trim()) throw new AppError('VALIDATION_FAILED', 'A reason is required');
    if (!actor.userId && !actor.system) throw new Error('Movement needs an actor');
    const d = movementDelta(m.type, m.qty);

    let rows: InventoryRow[];
    if (m.type === 'RESERVE') {
      rows = await tx.$queryRaw<InventoryRow[]>`
        UPDATE inventory SET reserved_quantity = reserved_quantity + ${m.qty}, version = version + 1, updated_at = now()
        WHERE outlet_id = ${m.outletId}::uuid AND product_variant_id = ${m.variantId}::uuid AND (is_listed OR ${m.ignoreBuffer === true})
          AND quantity_on_hand - reserved_quantity - (CASE WHEN ${m.ignoreBuffer === true} THEN 0 ELSE online_buffer_qty END) >= ${m.qty}
        RETURNING id, quantity_on_hand, reserved_quantity`;
      if (rows.length === 0) throw new AppError('OUT_OF_STOCK', 'Not enough stock', [{ variantId: m.variantId, requested: m.qty }]);
    } else {
      if (d.onHand > 0) await this.ensureRow(tx, m.outletId, m.variantId);
      rows = await tx.$queryRaw<InventoryRow[]>`
        UPDATE inventory
        SET quantity_on_hand = quantity_on_hand + ${d.onHand}, reserved_quantity = reserved_quantity + ${d.reserved},
            version = version + 1, updated_at = now()
        WHERE outlet_id = ${m.outletId}::uuid AND product_variant_id = ${m.variantId}::uuid
          AND quantity_on_hand + ${d.onHand} >= 0
          AND reserved_quantity + ${d.reserved} >= 0
          AND reserved_quantity + ${d.reserved} <= quantity_on_hand + ${d.onHand}
        RETURNING id, quantity_on_hand, reserved_quantity`;
      if (rows.length === 0) {
        const exists = await tx.inventory.findUnique({ where: { outletId_productVariantId: { outletId: m.outletId, productVariantId: m.variantId } } });
        if (!exists) throw notFound('Inventory item');
        throw new AppError('CONFLICT', 'Change would make stock negative or below reserved quantity', {
          onHand: exists.quantityOnHand,
          reserved: exists.reservedQuantity,
        });
      }
    }

    const row = rows[0] as InventoryRow;
    await tx.stockMovement.create({
      data: {
        id: newId(),
        inventoryId: row.id,
        outletId: m.outletId,
        productVariantId: m.variantId,
        type: m.type,
        qtyDeltaOnHand: d.onHand,
        qtyDeltaReserved: d.reserved,
        onHandAfter: row.quantity_on_hand,
        reservedAfter: row.reserved_quantity,
        reason: m.reason?.trim() || null,
        orderId: m.orderId ?? null,
        transferId: m.transferId ?? null,
        actorUserId: actor.userId ?? null,
        actorSystem: actor.system ?? null,
      },
    });
    return { onHand: row.quantity_on_hand, reserved: row.reserved_quantity };
  }

  /** Creates the outlet×variant row on first receipt (unlisted until a manager lists it). */
  private async ensureRow(tx: Tx, outletId: string, variantId: string): Promise<void> {
    await tx.$executeRaw`
      INSERT INTO inventory (id, outlet_id, product_variant_id, updated_at)
      VALUES (${newId()}::uuid, ${outletId}::uuid, ${variantId}::uuid, now())
      ON CONFLICT (outlet_id, product_variant_id) DO NOTHING`;
  }

  /**
   * Reserves every line for an order, in a deterministic order (by variant id)
   * so concurrent orders cannot deadlock. All-or-nothing within `tx`.
   */
  async reserveLines(tx: Tx, outletId: string, lines: readonly { variantId: string; qty: number }[], orderId: string | null): Promise<void> {
    const sorted = [...lines].sort((a, b) => a.variantId.localeCompare(b.variantId));
    for (const l of sorted) await this.apply(tx, { outletId, variantId: l.variantId, type: 'RESERVE', qty: l.qty, orderId }, { system: 'checkout' });
  }

  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn);
  }
}
