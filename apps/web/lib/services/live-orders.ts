import { validateCheckout } from '@dudhwala/shared';
import { api, ApiError } from '../api';
import type { AnyOrderStatus, DemoOrder, LivePaymentStatus, OrderService, PlaceOrderInput, PlaceResult } from './types';

interface ApiOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  method: DemoOrder['method'];
  zone: DemoOrder['zone'];
  status: AnyOrderStatus;
  paymentMethod: 'COD';
  paymentStatus: LivePaymentStatus;
  subtotalPoisha: number;
  deliveryFeePoisha: number;
  lines: { variantId: string | null; productSlug: string; nameBn: string; nameEn: string | null; labelBn: string; quantity: number; unitPricePoisha: number; linePoisha: number }[];
  totalPoisha: number;
  address: { name: string; phone: string; line1: string; landmark: string } | null;
  contact: { name: string; phone: string } | null;
  pickupAt: string | null;
  outlet: { id: string; nameBn: string; nameEn: string | null };
}

const toOrder = (o: ApiOrder): DemoOrder => ({
  id: o.id,
  orderNumber: o.orderNumber,
  demo: false,
  createdAt: o.createdAt,
  method: o.method,
  zone: o.zone,
  status: o.status,
  paymentMethod: o.paymentMethod,
  paymentStatus: o.paymentStatus,
  subtotalPoisha: o.subtotalPoisha,
  deliveryFeePoisha: o.deliveryFeePoisha,
  lines: o.lines.map((l) => ({ key: l.variantId ?? l.productSlug, productSlug: l.productSlug, nameBn: l.labelBn ? `${l.nameBn} (${l.labelBn})` : l.nameBn, nameEn: l.nameEn, quantity: l.quantity, unitPricePoisha: l.unitPricePoisha, linePoisha: l.linePoisha })),
  totalPoisha: o.totalPoisha,
  ...(o.address ? { address: o.address } : {}),
  ...(o.contact ? { contact: o.contact } : {}),
  outlet: o.outlet,
  ...(o.pickupAt ? { pickupAt: o.pickupAt } : {}),
  ...(o.method === 'HOME_DELIVERY' && o.zone ? { etaZone: o.zone } : {}),
});

/**
 * Live order service: the signed-in customer (session cookie) talks to the real API. The shared rules run here only to
 * give instant feedback; the API repeats every one of them and is the authority. Prices are never sent: the API prices
 * the order from its own catalogue.
 */
export const liveOrderService: OrderService = {
  async place(input: PlaceOrderInput & { config?: import('@dudhwala/shared').OrderingConfig }): Promise<PlaceResult> {
    const issues = validateCheckout({
      now: input.now,
      method: input.method,
      zone: input.zone,
      lines: input.lines.map((l) => ({ key: l.key, product: { categorySlug: l.categorySlug, outerCityStatus: l.outerCityStatus }, quantity: l.quantity, linePoisha: l.linePoisha })),
      address: input.address,
      outletId: input.outlet?.id ?? null,
      pickupAt: input.pickupAt ?? null,
      payment: 'DEMO_PAID_SIMULATED', // cash on delivery: nothing is prepaid, so the demo's prepayment rule does not apply
      ...(input.config ? { config: input.config } : {}),
    });
    if (issues.length > 0) return { ok: false, issues };
    const key = input.idempotencyKey ?? crypto.randomUUID();
    try {
      const order = await api<ApiOrder>('/orders', {
        method: 'POST',
        headers: { 'idempotency-key': key },
        body: {
          method: input.method,
          zone: input.method === 'HOME_DELIVERY' ? input.zone : null,
          lines: input.lines.map((l) => ({ variantId: l.key, quantity: l.quantity })),
          ...(input.method === 'HOME_DELIVERY'
            ? { address: { name: input.address.name, phone: input.address.phone, line1: input.address.line1, landmark: input.address.landmark || null } }
            : { contact: { name: input.address.name, phone: input.address.phone } }),
          ...(input.method === 'EXPRESS_PICKUP' ? { outletId: input.outlet?.id ?? null, pickupAt: input.pickupAt?.toISOString() ?? null } : {}),
        },
      });
      return { ok: true, order: toOrder(order) };
    } catch (e) {
      return { ok: false, issues: [], message: e instanceof ApiError ? e.message : 'অর্ডার দেওয়া যায়নি, আবার চেষ্টা করুন' };
    }
  },
  async status(id) {
    try {
      return (await api<{ status: AnyOrderStatus }>(`/orders/${encodeURIComponent(id)}/status`)).status;
    } catch {
      return null;
    }
  },
  async get(id) {
    try {
      return toOrder(await api<ApiOrder>(`/orders/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  async list() {
    return (await api<ApiOrder[]>('/orders')).map(toOrder);
  },
};
