/** Inventory arithmetic (DATABASE_SCHEMA §5). The DB enforces the same rules with CHECK constraints. */

export interface StockLevel {
  onHand: number;
  reserved: number;
  onlineBuffer: number;
}

export class StockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockError';
  }
}

/** Units that may still be sold online. Never negative. */
export function availableOnline(s: StockLevel): number {
  return Math.max(0, s.onHand - s.reserved - s.onlineBuffer);
}

export type MovementType =
  | 'RECEIVE'
  | 'ADJUST_UP'
  | 'ADJUST_DOWN'
  | 'RESERVE'
  | 'RELEASE'
  | 'COMMIT_SALE'
  | 'RESTOCK_RETURN'
  | 'WRITE_OFF'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'RECONCILE';

/** Movement types that need a human-written reason. */
export const MANUAL_MOVEMENT_TYPES: ReadonlySet<MovementType> = new Set([
  'ADJUST_UP',
  'ADJUST_DOWN',
  'WRITE_OFF',
  'RECONCILE',
  'RESTOCK_RETURN',
]);

export interface MovementDelta {
  onHand: number;
  reserved: number;
}

/**
 * Deltas applied to (onHand, reserved) for a movement of `qty` units.
 * RECONCILE takes a signed qty (counted − system). All others take qty > 0.
 */
export function movementDelta(type: MovementType, qty: number): MovementDelta {
  if (!Number.isSafeInteger(qty)) throw new StockError('qty must be an integer');
  if (type !== 'RECONCILE' && qty <= 0) throw new StockError('qty must be positive');
  switch (type) {
    case 'RECEIVE':
    case 'ADJUST_UP':
    case 'RESTOCK_RETURN':
    case 'TRANSFER_IN':
      return { onHand: qty, reserved: 0 };
    case 'ADJUST_DOWN':
    case 'WRITE_OFF':
    case 'TRANSFER_OUT':
      return { onHand: -qty, reserved: 0 };
    case 'RESERVE':
      return { onHand: 0, reserved: qty };
    case 'RELEASE':
      return { onHand: 0, reserved: -qty };
    case 'COMMIT_SALE':
      return { onHand: -qty, reserved: -qty };
    case 'RECONCILE':
      return { onHand: qty, reserved: 0 };
  }
}

/** Applies a movement, enforcing the same invariants as the DB CHECK constraints. */
export function applyMovement(level: StockLevel, type: MovementType, qty: number): StockLevel {
  const d = movementDelta(type, qty);
  const next = { ...level, onHand: level.onHand + d.onHand, reserved: level.reserved + d.reserved };
  if (next.onHand < 0) throw new StockError('on-hand would go negative');
  if (next.reserved < 0) throw new StockError('reserved would go negative');
  if (next.reserved > next.onHand) throw new StockError('reserved would exceed on-hand');
  if (type === 'RESERVE' && qty > availableOnline(level)) throw new StockError('insufficient stock');
  return next;
}
