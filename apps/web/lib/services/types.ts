import type { DeliveryZone, DemoPaymentState, FulfilmentMethod, Issue } from '@dudhwala/shared';

/** Demo order types. Phase 2 replaces the demo service, not these shapes (docs/PHASE2_INTEGRATION.md). */
export interface Outlet {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  addressLine: string | null;
}

export type { DemoOrderStatus } from '@dudhwala/shared';
import type { DemoOrderStatus } from '@dudhwala/shared';
export { ORDER_STATUS_FLOW as STATUS_FLOW } from '@dudhwala/shared';

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
}

export type PlaceResult = { ok: true; order: DemoOrder } | { ok: false; issues: Issue[]; message?: string };

/** Boundary between UI and order storage. Phase 1 demo: the mock API (saves to its runtime file). Phase 2: the real API. */
export interface OrderService {
  place(input: PlaceOrderInput & { config?: import('@dudhwala/shared').OrderingConfig }): Promise<PlaceResult>;
  /** Current status of an order (customers have no login in the demo; the order id is the handle). */
  status(id: string): Promise<DemoOrderStatus | null>;
  /** Full customer view of an order. `null` = not found (or wrong token). Throws on network failure. */
  get(id: string, token: string): Promise<DemoOrder | null>;
}
export interface OutletService {
  list(): Promise<Outlet[]>;
}
