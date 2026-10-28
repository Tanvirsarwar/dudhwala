import type { DeliveryZone, DemoPaymentState, FulfilmentMethod, Issue, OrderStatus } from '@dudhwala/shared';

/**
 * Order types shared by the local demo (mock API, DEMO_* statuses, `DEMO-n` ids, private order token) and the live
 * shop (real API, production statuses, signed-in customer). The service in ./index picks the implementation.
 */
export interface Outlet {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  addressLine: string | null;
}

import type { DemoOrderStatus } from '@dudhwala/shared';
export type { DemoOrderStatus } from '@dudhwala/shared';
export { ORDER_STATUS_FLOW as STATUS_FLOW } from '@dudhwala/shared';

/** A demo status (DEMO_PLACED, …) or a live one (PLACED, …). */
export type AnyOrderStatus = DemoOrderStatus | OrderStatus;
export type LivePaymentStatus = 'NOT_REQUIRED' | 'PENDING' | 'PAID' | 'FAILED';

export interface DemoOrderLine {
  key: string;
  productSlug: string;
  nameBn: string;
  nameEn: string | null;
  quantity: number;
  unitPricePoisha: number | null;
  linePoisha: number | null;
}

export interface DemoOrder {
  /** private lookup token returned once at creation; only the browser that placed the order keeps it */
  token?: string;
  /** demo: "DEMO-n" (never mistaken for a real order). live: the order's uuid; show `orderNumber` to people. */
  id: string;
  orderNumber?: string;
  demo: boolean;
  createdAt: string;
  method: FulfilmentMethod;
  zone: DeliveryZone | null;
  status: AnyOrderStatus;
  lines: DemoOrderLine[];
  /** null when any price is not known yet */
  totalPoisha: number | null;
  /** demo only */
  payment?: DemoPaymentState;
  /** live only */
  paymentStatus?: LivePaymentStatus;
  paymentExpiresAt?: string | null;
  address?: { name: string; phone: string; line1: string; landmark: string };
  /** pickup and bulk orders: who collects */
  contact?: { name: string; phone: string };
  outlet?: { id: string | null; nameBn: string; nameEn: string | null };
  pickupAt?: string;
  /** earliest-delivery promise text key, see lib/demo/eta */
  etaZone?: DeliveryZone;
}

export interface PlaceOrderInput {
  now: Date;
  method: FulfilmentMethod;
  zone: DeliveryZone | null;
  lines: (DemoOrderLine & { categorySlug: string; outerCityStatus?: import('@dudhwala/shared').OuterCityStatus | null })[];
  /** name + phone for every method; line1/landmark only matter for home delivery */
  address: { name: string; phone: string; line1: string; landmark: string };
  outlet?: Outlet | null;
  pickupAt?: Date | null;
  payment: DemoPaymentState;
  /** live: one key per checkout attempt, so a double tap or retry cannot create two orders */
  idempotencyKey?: string;
}

export type PlaceResult = { ok: true; order: DemoOrder } | { ok: false; issues: Issue[]; message?: string };

/** Boundary between UI and order storage. Phase 1 demo: the mock API (saves to its runtime file). Phase 2: the real API. */
export interface OrderService {
  place(input: PlaceOrderInput & { config?: import('@dudhwala/shared').OrderingConfig }): Promise<PlaceResult>;
  /** Current status of an order (customers have no login in the demo; the order id is the handle). */
  status(id: string): Promise<AnyOrderStatus | null>;
  /** Full customer view of an order. `null` = not found (or wrong token). Throws on network failure. */
  get(id: string, token: string): Promise<DemoOrder | null>;
  /** Live: the signed-in customer's orders, newest first. Demo: not used (orders are remembered per browser). */
  list?(): Promise<DemoOrder[]>;
}
export interface OutletService {
  list(): Promise<Outlet[]>;
}
