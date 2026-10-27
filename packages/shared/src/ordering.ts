/**
 * Phase-1 ordering rules: delivery-zone eligibility, ordering hours, express pickup lead time, bulk orders and
 * checkout validation. Pure functions with no UI or network code, so the future backend can run the SAME rules
 * server-side. In Phase 1 they run in the browser and are a DEMO convenience: they are not tamper-proof.
 */
import { tryNormalizeBdMobile } from './phone.js';

export type DeliveryZone = 'IN_CITY' | 'OUTER_CITY';
export type FulfilmentMethod = 'HOME_DELIVERY' | 'EXPRESS_PICKUP' | 'BULK_ORDER';
/** Product-level Outer City flag (data, admin-editable later). Absent = decided by the category rule only. */
export type OuterCityStatus = 'approved' | 'pending_verification' | 'pending_confirmation' | 'disabled';
export type DemoPaymentState = 'NOT_REQUIRED_DEMO' | 'DEMO_UNPAID' | 'DEMO_PAID_SIMULATED';

/* ───────────── eligibility ───────────── */

/** Category rules for Outer City (source: dudhwala-product-delivery-eligibility.md). Edit here, not in the UI. */
export const ELIGIBILITY_RULES = {
  /** every product in these categories is eligible unless it is flagged otherwise */
  outerCityWholeCategories: ['bakery'],
  /** only products flagged outerCityStatus = "approved" are eligible */
  outerCityApprovedOnlyCategories: ['dairy-sweets'],
} as const;

export interface EligibilityProduct {
  categorySlug: string;
  outerCityStatus?: OuterCityStatus | null | undefined;
}
export type EligibilityReason = 'in_city_all' | 'category_rule' | 'approved_item' | 'pending_verification' | 'pending_confirmation' | 'disabled' | 'item_not_approved' | 'category_not_approved';
export interface Eligibility {
  eligible: boolean;
  reason: EligibilityReason;
}

export function zoneEligibility(p: EligibilityProduct, zone: DeliveryZone): Eligibility {
  if (zone === 'IN_CITY') return { eligible: true, reason: 'in_city_all' };
  const s = p.outerCityStatus;
  // explicit "not yet confirmed" flags always win: uncertain entries are never enabled by accident
  if (s === 'pending_verification' || s === 'pending_confirmation' || s === 'disabled') return { eligible: false, reason: s };
  if ((ELIGIBILITY_RULES.outerCityWholeCategories as readonly string[]).includes(p.categorySlug)) return { eligible: true, reason: 'category_rule' };
  if ((ELIGIBILITY_RULES.outerCityApprovedOnlyCategories as readonly string[]).includes(p.categorySlug)) return s === 'approved' ? { eligible: true, reason: 'approved_item' } : { eligible: false, reason: 'item_not_approved' };
  return { eligible: false, reason: 'category_not_approved' };
}

/** Delivery promise shown to customers. Never "instant". */
export const DELIVERY_ESTIMATE: Record<DeliveryZone, { minHours: number; maxHours: number }> = {
  IN_CITY: { minHours: 0, maxHours: 24 },
  OUTER_CITY: { minHours: 24, maxHours: 48 },
};

/* ───────────── time (Asia/Dhaka, explicit) ───────────── */

export const ORDERING_HOURS = { timeZone: 'Asia/Dhaka', openMinute: 10 * 60, closeMinute: 22 * 60 } as const;
export type Hours = { timeZone: string; openMinute: number; closeMinute: number };

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
export const PICKUP_RULES = { minLeadMinutes: 60, slotStepMinutes: 30, hours: ORDERING_HOURS as Hours };

export const earliestPickup = (now: Date, leadMinutes: number = PICKUP_RULES.minLeadMinutes) => new Date(now.getTime() + leadMinutes * 60_000);

function inHours(at: Date, hours: Hours): boolean {
  const m = zonedParts(at, hours.timeZone).minutes;
  return m >= hours.openMinute && m <= hours.closeMinute;
}
/** Selectable pickup times: every `slotStepMinutes`, not before the earliest pickup, inside pickup hours. */
export function pickupSlots(now: Date, count = 12, rules = PICKUP_RULES): Date[] {
  const stepMs = rules.slotStepMinutes * 60_000;
  let t = Math.ceil(earliestPickup(now, rules.minLeadMinutes).getTime() / stepMs) * stepMs;
  const out: Date[] = [];
  for (let i = 0; i < 24 * 60 && out.length < count; i++, t += stepMs) if (inHours(new Date(t), rules.hours)) out.push(new Date(t));
  return out;
}
export type PickupCheck = { ok: true } | { ok: false; reason: 'invalid' | 'too_soon' | 'outside_hours' };
export function validatePickup(now: Date, at: Date | null, rules = PICKUP_RULES): PickupCheck {
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
}
/** Everything that must be fixed before a (demo) order can be placed. Empty array = valid. */
export function validateCheckout(i: CheckoutInput): Issue[] {
  const out: Issue[] = [];
  if (!orderingStatus(i.now).open) out.push({ code: 'ordering_closed' });
  if (i.lines.length === 0) out.push({ code: 'cart_empty' });
  const bulk = bulkStatus(i.lines.map((l) => ({ quantity: l.quantity, linePoisha: l.linePoisha })));
  if (bulk.isBulk && i.method !== 'BULK_ORDER') out.push({ code: 'bulk_requires_collection' });
  if (!bulk.isBulk && i.method === 'BULK_ORDER') out.push({ code: 'not_bulk' });
  if (i.method === 'HOME_DELIVERY') {
    if (!i.zone) out.push({ code: 'zone_required' });
    else for (const l of i.lines) if (!zoneEligibility(l.product, i.zone).eligible) out.push({ code: 'item_not_deliverable', line: l.key });
    if (!i.address?.name.trim()) out.push({ code: 'address_name_required' });
    if (!i.address || tryNormalizeBdMobile(i.address.phone) === null) out.push({ code: 'address_phone_invalid' });
    if (!i.address?.line1.trim()) out.push({ code: 'address_line_required' });
  }
  if (i.method === 'EXPRESS_PICKUP') {
    if (!i.outletId) out.push({ code: 'outlet_required' });
    const c = validatePickup(i.now, i.pickupAt ?? null);
    if (!c.ok) out.push({ code: c.reason === 'invalid' ? 'pickup_invalid' : c.reason === 'too_soon' ? 'pickup_too_soon' : 'pickup_outside_hours' });
  }
  if (i.method === 'BULK_ORDER' && i.payment !== 'DEMO_PAID_SIMULATED') out.push({ code: 'bulk_prepayment_required' });
  return out;
}
