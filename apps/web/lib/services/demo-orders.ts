import { validateCheckout } from '@dudhwala/shared';
import { STATUS_FLOW, type DemoOrder, type OrderService, type PlaceOrderInput, type PlaceResult } from './types';

/**
 * DEMO ONLY: orders live in this browser's localStorage under "dw.demo.orders". There is no server, database,
 * payment or notification. Replace this file with an API-backed OrderService in Phase 2.
 */
export const DEMO_ORDERS_KEY = 'dw.demo.orders';

const load = (): DemoOrder[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(DEMO_ORDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as DemoOrder[]) : [];
  } catch {
    return [];
  }
};
const save = (orders: DemoOrder[]) => {
  try {
    window.localStorage.setItem(DEMO_ORDERS_KEY, JSON.stringify(orders.slice(0, 50)));
  } catch {
    /* storage blocked: the order is shown once but not kept */
  }
  window.dispatchEvent(new Event('dw:demo-orders'));
};

export const demoOrderService: OrderService = {
  list: load,
  place(input: PlaceOrderInput): PlaceResult {
    const issues = validateCheckout({
      now: input.now,
      method: input.method,
      zone: input.zone,
      lines: input.lines.map((l) => ({ key: l.key, product: { categorySlug: l.categorySlug, outerCityStatus: l.outerCityStatus }, quantity: l.quantity, linePoisha: l.linePoisha })),
      address: input.address,
      outletId: input.outlet?.id ?? null,
      pickupAt: input.pickupAt ?? null,
      payment: input.payment,
    });
    if (issues.length > 0) return { ok: false, issues };
    const all = load();
    const n = 1001 + all.length;
    const order: DemoOrder = {
      id: `DEMO-${n}`,
      demo: true,
      createdAt: input.now.toISOString(),
      method: input.method,
      zone: input.zone,
      status: STATUS_FLOW[input.method][0] as DemoOrder['status'],
      lines: input.lines.map(({ key, productSlug, nameBn, nameEn, quantity, unitPricePoisha, linePoisha }) => ({ key, productSlug, nameBn, nameEn, quantity, unitPricePoisha, linePoisha })),
      totalPoisha: input.lines.some((l) => l.linePoisha === null) ? null : input.lines.reduce((s, l) => s + (l.linePoisha ?? 0), 0),
      payment: input.payment,
      ...(input.method === 'HOME_DELIVERY' && input.address ? { address: input.address, etaZone: input.zone ?? 'IN_CITY' } : {}),
      ...(input.method === 'EXPRESS_PICKUP' && input.outlet ? { outlet: { id: input.outlet.id, nameBn: input.outlet.nameBn, nameEn: input.outlet.nameEn }, pickupAt: input.pickupAt?.toISOString() } : {}),
      ...(input.method === 'BULK_ORDER' ? { outlet: { id: null, nameBn: 'মদিনা মার্কেট শাখা', nameEn: 'Modina Market Branch' } } : {}),
    };
    save([order, ...all]);
    return { ok: true, order };
  },
  advance(id) {
    const all = load();
    const o = all.find((x) => x.id === id);
    if (!o) return null;
    const flow = STATUS_FLOW[o.method];
    const i = flow.indexOf(o.status);
    const next = flow[Math.min(flow.length - 1, i + 1)];
    if (next) o.status = next;
    save(all);
    return o;
  },
  clear() {
    save([]);
  },
};
