import { validateCheckout } from '@dudhwala/shared';
import { api, ApiError } from '../api';
import type { DemoOrder, DemoOrderStatus, OrderService, PlaceOrderInput, PlaceResult } from './types';

/**
 * Demo order service: validates with the shared rules, then saves the order through the mock API (POST /orders).
 * The mock API prices the order itself from its own catalogue and repeats the zone and bulk checks. Phase 2: same calls
 * against the real API, which must also enforce ordering hours, stock and payment.
 */
export const demoOrderService: OrderService = {
  async place(input: PlaceOrderInput & { config?: import('@dudhwala/shared').OrderingConfig }): Promise<PlaceResult> {
    const issues = validateCheckout({
      now: input.now,
      method: input.method,
      zone: input.zone,
      lines: input.lines.map((l) => ({ key: l.key, product: { categorySlug: l.categorySlug, outerCityStatus: l.outerCityStatus }, quantity: l.quantity, linePoisha: l.linePoisha })),
      address: input.address,
      outletId: input.outlet?.id ?? null,
      pickupAt: input.pickupAt ?? null,
      payment: input.payment,
      ...(input.config ? { config: input.config } : {}),
    });
    if (issues.length > 0) return { ok: false, issues };
    try {
      const order = await api<DemoOrder>('/orders', {
        method: 'POST',
        body: {
          method: input.method,
          zone: input.zone,
          lines: input.lines.map((l) => ({ variantId: l.key, quantity: l.quantity })),
          ...(input.method === 'HOME_DELIVERY' ? { address: input.address } : { contact: { name: input.address.name, phone: input.address.phone } }),
          outletId: input.outlet?.id ?? null,
          pickupAt: input.pickupAt?.toISOString() ?? null,
          payment: input.payment,
        },
      });
      return { ok: true, order };
    } catch (e) {
      return { ok: false, issues: [], message: e instanceof ApiError ? e.message : 'অর্ডার সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন' };
    }
  },
  async status(id) {
    try {
      return (await api<{ status: DemoOrderStatus }>(`/orders/${encodeURIComponent(id)}/status`)).status;
    } catch {
      return null;
    }
  },
};
