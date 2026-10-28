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
  paymentStatus: LivePaymentStatus;
  paymentExpiresAt: string | null;
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
  paymentStatus: o.paymentStatus,
  paymentExpiresAt: o.paymentExpiresAt,
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
      payment: 'DEMO_PAID_SIMULATED', // a bulk order is paid after it is placed (see payment step), so skip the prepayment check here
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

export interface PaymentStart {
  merchantTranId: string;
  provider: string;
  sandbox: boolean;
  redirectUrl: string | null;
}
/** Bulk-order payment. Only the API's webhook can mark an order paid; the sandbox call below stands in for the gateway and moves no money. */
export const paymentService = {
  start: (orderId: string) => api<PaymentStart>(`/orders/${encodeURIComponent(orderId)}/payment`, { method: 'POST', body: {} }),
  sandboxComplete: (merchantTranId: string, outcome: 'success' | 'fail') => api<{ result: string }>(`/payments/sandbox/${encodeURIComponent(merchantTranId)}/complete`, { method: 'POST', body: { outcome } }),
};
