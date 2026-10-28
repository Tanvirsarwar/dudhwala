/**
 * DEMO ONLY: orders placed from this browser, remembered in localStorage ("dw.demo.myOrders") as { id, token }.
 * The demo has no customer login, so the token is the proof that this browser placed the order.
 * Phase 2: replaced by the signed-in customer's order history from the API.
 */
export const MY_ORDERS_KEY = 'dw.demo.myOrders';
export interface OrderRef {
  id: string;
  token: string;
}
const MAX = 30;

export function readOrderRefs(): OrderRef[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(MY_ORDERS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((r): r is OrderRef => typeof r?.id === 'string' && typeof r?.token === 'string') : [];
  } catch {
    return [];
  }
}
function write(refs: OrderRef[]) {
  try {
    window.localStorage.setItem(MY_ORDERS_KEY, JSON.stringify(refs.slice(0, MAX)));
  } catch {
    /* storage blocked: the order is shown once but not remembered */
  }
  window.dispatchEvent(new Event('dw:my-orders'));
}
export const rememberOrder = (id: string, token: string) => write([{ id, token }, ...readOrderRefs().filter((r) => r.id !== id)]);
export const forgetOrder = (id: string) => write(readOrderRefs().filter((r) => r.id !== id));
export const tokenFor = (id: string) => readOrderRefs().find((r) => r.id === id)?.token ?? null;
