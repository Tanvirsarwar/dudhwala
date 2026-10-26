/**
 * Order status state machine (DATABASE_SCHEMA §8.1, APP_FLOW §2.1).
 * Payment status is a separate machine (payment-state.ts).
 */

export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PLACED',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_DISPATCH',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Who may cause a transition. Permissions are checked separately by the API. */
export type OrderActor = 'CUSTOMER' | 'STAFF' | 'RIDER' | 'SYSTEM';

type TransitionTable = Record<OrderStatus, Partial<Record<OrderStatus, readonly OrderActor[]>>>;

const T: TransitionTable = {
  PENDING_PAYMENT: {
    PLACED: ['SYSTEM'], // only after verified payment
    EXPIRED: ['SYSTEM'],
    CANCELLED: ['CUSTOMER', 'STAFF', 'SYSTEM'],
  },
  PLACED: {
    CONFIRMED: ['STAFF', 'SYSTEM'], // SYSTEM = outlet auto-confirm setting
    REJECTED: ['STAFF'],
    CANCELLED: ['CUSTOMER', 'STAFF'],
  },
  CONFIRMED: {
    PREPARING: ['STAFF'],
    CANCELLED: ['CUSTOMER', 'STAFF'],
  },
  PREPARING: {
    READY_FOR_DISPATCH: ['STAFF'],
    CANCELLED: ['STAFF'],
  },
  READY_FOR_DISPATCH: {
    OUT_FOR_DELIVERY: ['STAFF'],
    CANCELLED: ['STAFF'],
  },
  OUT_FOR_DELIVERY: {
    DELIVERED: ['RIDER', 'STAFF'],
    DELIVERY_FAILED: ['RIDER', 'STAFF'],
  },
  DELIVERY_FAILED: {
    READY_FOR_DISPATCH: ['STAFF'], // rescheduled into a new slot
    CANCELLED: ['STAFF'], // closed after failed attempts
  },
  DELIVERED: {},
  CANCELLED: {},
  REJECTED: {},
  // Recovery path: payment verified after the hold expired and stock + slot
  // could be reserved again (APP_FLOW §1.3).
  EXPIRED: { PLACED: ['SYSTEM'] },
};

export function allowedOrderTransitions(from: OrderStatus, actor: OrderActor): OrderStatus[] {
  return (Object.entries(T[from]) as [OrderStatus, readonly OrderActor[]][])
    .filter(([, actors]) => actors.includes(actor))
    .map(([to]) => to);
}

export function canTransitionOrder(from: OrderStatus, to: OrderStatus, actor: OrderActor): boolean {
  return T[from][to]?.includes(actor) ?? false;
}

export class InvalidTransitionError extends Error {
  readonly code = 'INVALID_TRANSITION';
  constructor(
    readonly from: string,
    readonly to: string,
    readonly actor: string,
  ) {
    super(`Transition ${from} → ${to} not allowed for ${actor}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus, actor: OrderActor): void {
  if (!canTransitionOrder(from, to, actor)) throw new InvalidTransitionError(from, to, actor);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'DELIVERED' || status === 'CANCELLED' || status === 'REJECTED';
}

/** Statuses in which the order holds reserved stock and a booked slot. */
export function holdsReservation(status: OrderStatus): boolean {
  return (
    status === 'PENDING_PAYMENT' ||
    status === 'PLACED' ||
    status === 'CONFIRMED' ||
    status === 'PREPARING' ||
    status === 'READY_FOR_DISPATCH' ||
    status === 'DELIVERY_FAILED'
  );
}
