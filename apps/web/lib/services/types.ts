import type { DeliveryZone, DemoPaymentState, FulfilmentMethod, Issue } from '@dudhwala/shared';

/** Demo order types. Phase 2 replaces the demo service, not these shapes (docs/PHASE2_INTEGRATION.md). */
export interface Outlet {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  addressLine: string | null;
}

export type DemoOrderStatus =
  | 'DEMO_PLACED'
  | 'DEMO_PREPARING'
  | 'DEMO_OUT_FOR_DELIVERY'
  | 'DEMO_DELIVERED'
  | 'DEMO_PICKUP_REQUESTED'
  | 'DEMO_READY_FOR_PICKUP'
  | 'DEMO_PICKED_UP'
  | 'DEMO_PREPAID_SIMULATED'
  | 'DEMO_READY_FOR_COLLECTION'
  | 'DEMO_COLLECTED';

/** Status sequence per fulfilment method. Pickup/collection is confirmed only at the READY step. */
export const STATUS_FLOW: Record<FulfilmentMethod, DemoOrderStatus[]> = {
  HOME_DELIVERY: ['DEMO_PLACED', 'DEMO_PREPARING', 'DEMO_OUT_FOR_DELIVERY', 'DEMO_DELIVERED'],
  EXPRESS_PICKUP: ['DEMO_PICKUP_REQUESTED', 'DEMO_PREPARING', 'DEMO_READY_FOR_PICKUP', 'DEMO_PICKED_UP'],
  BULK_ORDER: ['DEMO_PREPAID_SIMULATED', 'DEMO_PREPARING', 'DEMO_READY_FOR_COLLECTION', 'DEMO_COLLECTED'],
};

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
  /** always starts with "DEMO-": never mistaken for a real order number */
  id: string;
  demo: true;
  createdAt: string;
  method: FulfilmentMethod;
  zone: DeliveryZone | null;
  status: DemoOrderStatus;
  lines: DemoOrderLine[];
  /** null when any price is not known yet */
  totalPoisha: number | null;
  payment: DemoPaymentState;
  address?: { name: string; phone: string; line1: string; landmark: string };
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
  address?: { name: string; phone: string; line1: string; landmark: string };
  outlet?: Outlet | null;
  pickupAt?: Date | null;
  payment: DemoPaymentState;
}

export type PlaceResult = { ok: true; order: DemoOrder } | { ok: false; issues: Issue[] };

/** Boundary between UI and order storage. Phase 1: browser localStorage. Phase 2: HTTP calls to the real API. */
export interface OrderService {
  place(input: PlaceOrderInput): PlaceResult;
  list(): DemoOrder[];
  /** Simulates outlet staff moving an order to its next status (demo only). */
  advance(id: string): DemoOrder | null;
  clear(): void;
}
export interface OutletService {
  list(): Promise<Outlet[]>;
}
