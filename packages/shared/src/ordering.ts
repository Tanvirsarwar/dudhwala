/**
 * Phase-1 ordering rules: delivery-zone eligibility, ordering hours, express pickup lead time, bulk orders and
 * checkout validation. Pure functions with no UI or network code, so the future backend can run the SAME rules
 * server-side. In Phase 1 they run in the browser and are a DEMO convenience: they are not tamper-proof.
 */
import { tryNormalizeBdMobile } from './phone.js';

export type DeliveryZone = 'IN_CITY' | 'OUTER_CITY';
export type FulfilmentMethod = 'HOME_DELIVERY' | 'EXPRESS_PICKUP' | 'BULK_ORDER';
/** Product-level Outer Sylhet flag (data, admin-editable later). Absent = decided by the category rule only. */
export type OuterCityStatus = 'approved' | 'pending_verification' | 'pending_confirmation' | 'disabled';
export type DemoPaymentState = 'NOT_REQUIRED_DEMO' | 'DEMO_UNPAID' | 'DEMO_PAID_SIMULATED';

/* ───────────── eligibility ───────────── */

/**
 * Outer Sylhet rules. Whole Bakery category is eligible; every other item is eligible only when the owner flags it
 * "approved" (admin product page). Items flagged pending/disabled are never eligible, whatever their category.
 */
export const ELIGIBILITY_RULES = {
  outerCityWholeCategories: ['bakery'],
} as const;

export interface EligibilityProduct {
  categorySlug: string;
  outerCityStatus?: OuterCityStatus | null | undefined;
}
export type EligibilityReason = 'in_city_all' | 'category_rule' | 'approved_item' | 'pending_verification' | 'pending_confirmation' | 'disabled' | 'item_not_approved';
export interface Eligibility {
  eligible: boolean;
  reason: EligibilityReason;
}

export function zoneEligibility(p: EligibilityProduct, zone: DeliveryZone): Eligibility {
  if (zone === 'IN_CITY') return { eligible: true, reason: 'in_city_all' };
  const s = p.outerCityStatus;
  // explicit "not yet confirmed / switched off" flags always win: uncertain entries are never enabled by accident
  if (s === 'pending_verification' || s === 'pending_confirmation' || s === 'disabled') return { eligible: false, reason: s };
  if (s === 'approved') return { eligible: true, reason: 'approved_item' };
  if ((ELIGIBILITY_RULES.outerCityWholeCategories as readonly string[]).includes(p.categorySlug)) return { eligible: true, reason: 'category_rule' };
  return { eligible: false, reason: 'item_not_approved' };
}

/** Delivery promise shown to customers. Never "instant". */
export const DELIVERY_ESTIMATE: Record<DeliveryZone, { minHours: number; maxHours: number }> = {
  IN_CITY: { minHours: 0, maxHours: 24 },
  OUTER_CITY: { minHours: 24, maxHours: 48 },
};

/* ───────────── time (Asia/Dhaka, explicit) ───────────── */

export type Hours = { timeZone: string; openMinute: number; closeMinute: number };
export const ORDERING_HOURS: Hours = { timeZone: 'Asia/Dhaka', openMinute: 10 * 60, closeMinute: 22 * 60 };

/** Minutes after midnight <-> "HH:MM". */
export const minutesToHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export function hhmmToMinutes(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2])];
  return h <= 24 && min < 60 && h * 60 + min <= 24 * 60 ? h * 60 + min : null;
}

interface Parts {
  y: number;
  m: number;
  d: number;
  minutes: number;
}
/** Wall-clock parts of an instant in the given time zone. */
export function zonedParts(at: Date, timeZone: string = ORDERING_HOURS.timeZone): Parts {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const v: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') v[p.type] = Number(p.value);
  return { y: v.year ?? 0, m: v.month ?? 1, d: v.day ?? 1, minutes: (v.hour ?? 0) * 60 + (v.minute ?? 0) };
}
/** Instant for a wall-clock time in the zone (Asia/Dhaka has a fixed offset; the offset is read from `ref`). */
function fromZoned(y: number, m: number, d: number, minutes: number, ref: Date, timeZone: string): Date {
  const p = zonedParts(ref, timeZone);
  const offsetMin = (Date.UTC(p.y, p.m - 1, p.d, 0, p.minutes) - Math.floor(ref.getTime() / 60_000) * 60_000) / 60_000;
  return new Date(Date.UTC(y, m - 1, d, 0, minutes) - offsetMin * 60_000);
}

export interface OrderingStatus {
  open: boolean;
  /** next opening instant when closed */
  reopensAt: Date | null;
  /** closing instant when open */
  closesAt: Date | null;
}
/** Are new orders accepted right now? 10:00-22:00 Asia/Dhaka by default. Use the real clock: pass `new Date()`. */
export function orderingStatus(now: Date, hours: Hours = ORDERING_HOURS): OrderingStatus {
  const p = zonedParts(now, hours.timeZone);
  if (p.minutes >= hours.openMinute && p.minutes < hours.closeMinute) {
    return { open: true, reopensAt: null, closesAt: fromZoned(p.y, p.m, p.d, hours.closeMinute, now, hours.timeZone) };
  }
  const sameDay = p.minutes < hours.openMinute;
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + (sameDay ? 0 : 1)));
  return { open: false, reopensAt: fromZoned(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hours.openMinute, now, hours.timeZone), closesAt: null };
}

/* ───────────── express pickup ───────────── */

/** Minimum gap between placing an order and the earliest pickup. Pickup hours reuse the ordering hours until the
 *  outlets' real opening hours are confirmed (placeholder, documented). */
export const PICKUP_RULES = { minLeadMinutes: 60, slotStepMinutes: 30, hours: ORDERING_HOURS };
export type PickupRules = typeof PICKUP_RULES;

export const earliestPickup = (now: Date, leadMinutes: number = PICKUP_RULES.minLeadMinutes) => new Date(now.getTime() + leadMinutes * 60_000);

function inHours(at: Date, hours: Hours): boolean {
  const m = zonedParts(at, hours.timeZone).minutes;
  return m >= hours.openMinute && m <= hours.closeMinute;
}
/** Selectable pickup times: every `slotStepMinutes`, not before the earliest pickup, inside pickup hours. */
export function pickupSlots(now: Date, count = 12, rules: PickupRules = PICKUP_RULES): Date[] {
  const stepMs = rules.slotStepMinutes * 60_000;
  let t = Math.ceil(earliestPickup(now, rules.minLeadMinutes).getTime() / stepMs) * stepMs;
  const out: Date[] = [];
  for (let i = 0; i < 24 * 60 && out.length < count; i++, t += stepMs) if (inHours(new Date(t), rules.hours)) out.push(new Date(t));
  return out;
}
export type PickupCheck = { ok: true } | { ok: false; reason: 'invalid' | 'too_soon' | 'outside_hours' };
export function validatePickup(now: Date, at: Date | null, rules: PickupRules = PICKUP_RULES): PickupCheck {
  if (!at || Number.isNaN(at.getTime())) return { ok: false, reason: 'invalid' };
  if (at.getTime() < earliestPickup(now, rules.minLeadMinutes).getTime()) return { ok: false, reason: 'too_soon' };
  if (!inHours(at, rules.hours)) return { ok: false, reason: 'outside_hours' };
  return { ok: true };
}

/* ───────────── bulk orders ───────────── */

/** DEMO PLACEHOLDER thresholds: the business has not supplied approved values. Replace via configuration. */
export const BULK_CONFIG = {
  isPlaceholder: true,
  minTotalQuantity: 20,
  minTotalPoisha: 2_000_000,
  collectionBranch: { nameEn: 'Modina Market Branch', nameBn: 'মদিনা মার্কেট শাখা', outletId: null as string | null /* not in the project's outlet data: map in Phase 2 */ },
};
export type BulkConfig = typeof BULK_CONFIG;
/** Settings the admin can change (served by the API as /config). */
export interface OrderingConfig {
  hours: Pick<Hours, 'openMinute' | 'closeMinute'>;
  bulk: Pick<BulkConfig, 'minTotalQuantity' | 'minTotalPoisha'>;
}
export const DEFAULT_ORDERING_CONFIG: OrderingConfig = { hours: { openMinute: ORDERING_HOURS.openMinute, closeMinute: ORDERING_HOURS.closeMinute }, bulk: { minTotalQuantity: BULK_CONFIG.minTotalQuantity, minTotalPoisha: BULK_CONFIG.minTotalPoisha } };
export const hoursOf = (c: OrderingConfig): Hours => ({ timeZone: ORDERING_HOURS.timeZone, ...c.hours });
export interface PricedLine {
  quantity: number;
  /** line total in poisha, or null when the price is not known yet */
  linePoisha: number | null;
}
export interface BulkStatus {
  isBulk: boolean;
  totalQuantity: number;
  /** null when any line has an unknown price (the amount threshold cannot be evaluated) */
  totalPoisha: number | null;
  byQuantity: boolean;
  byAmount: boolean | null;
}
/** Bulk when EITHER threshold is reached. */
export function bulkStatus(lines: PricedLine[], cfg: Pick<BulkConfig, 'minTotalQuantity' | 'minTotalPoisha'> = BULK_CONFIG): BulkStatus {
  const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
  const totalPoisha = lines.some((l) => l.linePoisha === null) ? null : lines.reduce((s, l) => s + (l.linePoisha ?? 0), 0);
  const byQuantity = totalQuantity >= cfg.minTotalQuantity;
  const byAmount = totalPoisha === null ? null : totalPoisha >= cfg.minTotalPoisha;
  return { isBulk: byQuantity || byAmount === true, totalQuantity, totalPoisha, byQuantity, byAmount };
}
/** Fulfilment options a cart may use: bulk carts can only be collected (no delivery, no express pickup). */
export const availableFulfilments = (bulk: boolean): FulfilmentMethod[] => (bulk ? ['BULK_ORDER'] : ['HOME_DELIVERY', 'EXPRESS_PICKUP']);

/* ───────────── checkout validation ───────────── */

export type IssueCode =
  | 'ordering_closed'
  | 'cart_empty'
  | 'bulk_requires_collection'
  | 'not_bulk'
  | 'zone_required'
  | 'item_not_deliverable'
  | 'address_name_required'
  | 'address_phone_invalid'
  | 'address_line_required'
  | 'outlet_required'
  | 'pickup_invalid'
  | 'pickup_too_soon'
  | 'pickup_outside_hours'
  | 'bulk_prepayment_required';
export interface Issue {
  code: IssueCode;
  /** cart line key for item-level issues */
  line?: string;
}
export interface CheckoutLine {
  key: string;
  product: EligibilityProduct;
  quantity: number;
  linePoisha: number | null;
}
export interface CheckoutInput {
  now: Date;
  method: FulfilmentMethod;
  zone: DeliveryZone | null;
  lines: CheckoutLine[];
  address?: { name: string; phone: string; line1: string };
  outletId?: string | null;
  pickupAt?: Date | null;
  payment?: DemoPaymentState;
  /** admin-edited settings; defaults apply when omitted */
  config?: OrderingConfig;
}
/** Everything that must be fixed before a (demo) order can be placed. Empty array = valid. */
export function validateCheckout(i: CheckoutInput): Issue[] {
  const out: Issue[] = [];
  const cfg = i.config ?? DEFAULT_ORDERING_CONFIG;
  const hours = hoursOf(cfg);
  if (!orderingStatus(i.now, hours).open) out.push({ code: 'ordering_closed' });
  if (i.lines.length === 0) out.push({ code: 'cart_empty' });
  const bulk = bulkStatus(i.lines.map((l) => ({ quantity: l.quantity, linePoisha: l.linePoisha })), cfg.bulk);
  if (bulk.isBulk && i.method !== 'BULK_ORDER') out.push({ code: 'bulk_requires_collection' });
  if (!bulk.isBulk && i.method === 'BULK_ORDER') out.push({ code: 'not_bulk' });
  if (i.method === 'HOME_DELIVERY') {
    if (!i.zone) out.push({ code: 'zone_required' });
    else for (const l of i.lines) if (!zoneEligibility(l.product, i.zone).eligible) out.push({ code: 'item_not_deliverable', line: l.key });
  }
  // every method needs a contact name and mobile number; only home delivery needs a street address
  if (!i.address?.name.trim()) out.push({ code: 'address_name_required' });
  if (!i.address || tryNormalizeBdMobile(i.address.phone) === null) out.push({ code: 'address_phone_invalid' });
  if (i.method === 'HOME_DELIVERY' && !i.address?.line1.trim()) out.push({ code: 'address_line_required' });
  if (i.method === 'EXPRESS_PICKUP') {
    if (!i.outletId) out.push({ code: 'outlet_required' });
    const c = validatePickup(i.now, i.pickupAt ?? null, { ...PICKUP_RULES, hours });
    if (!c.ok) out.push({ code: c.reason === 'invalid' ? 'pickup_invalid' : c.reason === 'too_soon' ? 'pickup_too_soon' : 'pickup_outside_hours' });
  }
  if (i.method === 'BULK_ORDER' && i.payment !== 'DEMO_PAID_SIMULATED') out.push({ code: 'bulk_prepayment_required' });
  return out;
}

/* ───────────── demo order statuses (shared by storefront, admin and the demo API) ───────────── */

export type DemoOrderStatus =
  | 'DEMO_PLACED' | 'DEMO_PREPARING' | 'DEMO_OUT_FOR_DELIVERY' | 'DEMO_DELIVERED'
  | 'DEMO_PICKUP_REQUESTED' | 'DEMO_READY_FOR_PICKUP' | 'DEMO_PICKED_UP'
  | 'DEMO_PREPAID_SIMULATED' | 'DEMO_READY_FOR_COLLECTION' | 'DEMO_COLLECTED'
  | 'DEMO_CANCELLED';

/** Status sequence per fulfilment method. Pickup/collection is confirmed only at the READY step. */
export const ORDER_STATUS_FLOW: Record<FulfilmentMethod, DemoOrderStatus[]> = {
  HOME_DELIVERY: ['DEMO_PLACED', 'DEMO_PREPARING', 'DEMO_OUT_FOR_DELIVERY', 'DEMO_DELIVERED'],
  EXPRESS_PICKUP: ['DEMO_PICKUP_REQUESTED', 'DEMO_PREPARING', 'DEMO_READY_FOR_PICKUP', 'DEMO_PICKED_UP'],
  BULK_ORDER: ['DEMO_PREPAID_SIMULATED', 'DEMO_PREPARING', 'DEMO_READY_FOR_COLLECTION', 'DEMO_COLLECTED'],
};

export const METHOD_BN: Record<FulfilmentMethod, string> = { HOME_DELIVERY: 'হোম ডেলিভারি', EXPRESS_PICKUP: 'এক্সপ্রেস পিকআপ', BULK_ORDER: 'শোরুম থেকে অর্ডার' };

/** Customer-facing wording: pickup counts as confirmed only once the outlet has marked it ready. */
export const ORDER_STATUS_BN: Record<DemoOrderStatus, string> = {
  DEMO_PLACED: 'অর্ডার নেওয়া হয়েছে',
  DEMO_PREPARING: 'প্রস্তুত করা হচ্ছে',
  DEMO_OUT_FOR_DELIVERY: 'ডেলিভারির পথে',
  DEMO_DELIVERED: 'ডেলিভারি সম্পন্ন',
  DEMO_PICKUP_REQUESTED: 'পিকআপের অনুরোধ নেওয়া হয়েছে — এখনো নিশ্চিত নয়',
  DEMO_READY_FOR_PICKUP: 'পিকআপ নিশ্চিত — অর্ডার প্রস্তুত',
  DEMO_PICKED_UP: 'পিকআপ সম্পন্ন',
  DEMO_PREPAID_SIMULATED: 'সিমুলেটেড প্রিপেমেন্ট হয়েছে — প্রস্তুতির অপেক্ষায়',
  DEMO_READY_FOR_COLLECTION: 'সংগ্রহের জন্য প্রস্তুত',
  DEMO_COLLECTED: 'সংগ্রহ সম্পন্ন',
  DEMO_CANCELLED: 'বাতিল করা হয়েছে',
};

/* ───────────── production order statuses (real backend; the DEMO_* set above is for the local demo only) ───────────── */

export type OrderStatus =
  | 'PLACED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED'
  | 'PICKUP_REQUESTED' | 'READY_FOR_PICKUP' | 'PICKED_UP'
  | 'READY_FOR_COLLECTION' | 'COLLECTED'
  | 'CANCELLED';

/** Forward-only status sequence per method. Payment is separate (cash on delivery / at the showroom): see PaymentStatus. */
export const ORDER_FLOW: Record<FulfilmentMethod, OrderStatus[]> = {
  HOME_DELIVERY: ['PLACED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  EXPRESS_PICKUP: ['PICKUP_REQUESTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP'],
  BULK_ORDER: ['PLACED', 'PREPARING', 'READY_FOR_COLLECTION', 'COLLECTED'],
};

/** Cash on delivery is the only payment method. UNPAID until staff record that the cash was collected. */
export type PaymentMethod = 'COD';
export type PaymentStatus = 'UNPAID' | 'PAID';
export const PAYMENT_STATUS_BN: Record<PaymentStatus, string> = { UNPAID: 'পেমেন্ট বাকি (ক্যাশ অন ডেলিভারি)', PAID: 'পেমেন্ট নেওয়া হয়েছে' };

/** Delivery fee per zone, in poisha. The shop sets these in Settings; unset means no fee. */
export type DeliveryFees = Record<DeliveryZone, number>;
export const NO_DELIVERY_FEES: DeliveryFees = { IN_CITY: 0, OUTER_CITY: 0 };
/** Only home delivery is charged; pickup and showroom collection never are. */
export const deliveryFeePoisha = (method: FulfilmentMethod, zone: DeliveryZone | null, fees: DeliveryFees = NO_DELIVERY_FEES): number => (method === 'HOME_DELIVERY' && zone ? fees[zone] : 0);

export const orderInitialStatus = (m: FulfilmentMethod): OrderStatus => ORDER_FLOW[m][0] as OrderStatus;
export const orderFinalStatus = (m: FulfilmentMethod): OrderStatus => ORDER_FLOW[m].at(-1) as OrderStatus;

/** Statuses an admin may move an order to next: strictly one step forward, or CANCELLED while the order is live. */
export function nextOrderStatuses(method: FulfilmentMethod, current: OrderStatus): OrderStatus[] {
  if (current === 'CANCELLED' || current === orderFinalStatus(method)) return [];
  const flow = ORDER_FLOW[method];
  const i = flow.indexOf(current);
  if (i < 0) return [];
  const next = flow[i + 1];
  const out: OrderStatus[] = [];
  if (next) out.push(next);
  out.push('CANCELLED');
  return out;
}

export const ORDER_STATUS_LABEL_BN: Record<OrderStatus, string> = {
  PLACED: 'অর্ডার নেওয়া হয়েছে',
  PREPARING: 'প্রস্তুত করা হচ্ছে',
  OUT_FOR_DELIVERY: 'ডেলিভারির পথে',
  DELIVERED: 'ডেলিভারি সম্পন্ন',
  PICKUP_REQUESTED: 'পিকআপের অনুরোধ নেওয়া হয়েছে — এখনো নিশ্চিত নয়',
  READY_FOR_PICKUP: 'পিকআপ নিশ্চিত — অর্ডার প্রস্তুত',
  PICKED_UP: 'পিকআপ সম্পন্ন',
  READY_FOR_COLLECTION: 'সংগ্রহের জন্য প্রস্তুত',
  COLLECTED: 'সংগ্রহ সম্পন্ন',
  CANCELLED: 'বাতিল করা হয়েছে',
};
