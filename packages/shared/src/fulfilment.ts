/**
 * Outlet eligibility and selection (APP_FLOW §2.3).
 * Pure function over a snapshot; the API re-validates inside the order
 * transaction with conditional updates, so this never guarantees a booking.
 */
import { availableOnline, type StockLevel } from './inventory.js';
import type { Poisha } from './money.js';

export interface OutletSnapshot {
  outletId: string;
  code: string;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  acceptsOnlineOrders: boolean;
  /** Zone rule serving the customer's area, or null when this outlet does not serve it. */
  zoneRule: { active: boolean; priority: number; minOrderPoisha: Poisha } | null;
  /** Stock per variant id; missing = not listed at this outlet. */
  stock: ReadonlyMap<string, StockLevel & { isListed: boolean }>;
  slots: readonly SlotSnapshot[];
}

export interface SlotSnapshot {
  slotId: string;
  startsAt: Date;
  endsAt: Date;
  cutoffAt: Date;
  capacity: number;
  bookedCount: number;
  status: 'OPEN' | 'CLOSED';
}

export interface CartLine {
  variantId: string;
  quantity: number;
}

export type ExclusionReason = 'INACTIVE' | 'AREA_NOT_SERVED' | 'ITEM_UNAVAILABLE' | 'MIN_ORDER_NOT_MET' | 'NO_SLOTS';

export interface EligibleOutlet {
  outletId: string;
  code: string;
  priority: number;
  /** Smallest (available − requested) across lines: stock headroom. */
  headroom: number;
  openSlots: SlotSnapshot[];
}

export interface EligibilityResult {
  eligible: EligibleOutlet[];
  excluded: { outletId: string; reason: ExclusionReason; blockingVariantIds?: string[] }[];
  /** True when every line is available somewhere, but no single outlet has them all. */
  noSingleOutlet: boolean;
  /** Variants not available at any outlet serving the area. */
  unavailableEverywhere: string[];
}

export function isSlotBookable(slot: SlotSnapshot, now: Date): boolean {
  return slot.status === 'OPEN' && slot.cutoffAt > now && slot.bookedCount < slot.capacity;
}

export function evaluateOutlets(
  outlets: readonly OutletSnapshot[],
  lines: readonly CartLine[],
  subtotalPoisha: Poisha,
  now: Date,
): EligibilityResult {
  const eligible: EligibleOutlet[] = [];
  const excluded: EligibilityResult['excluded'] = [];
  const availableSomewhere = new Set<string>();
  let anyServing = false;

  for (const o of outlets) {
    if (o.status !== 'ACTIVE' || !o.acceptsOnlineOrders) {
      excluded.push({ outletId: o.outletId, reason: 'INACTIVE' });
      continue;
    }
    if (!o.zoneRule?.active) {
      excluded.push({ outletId: o.outletId, reason: 'AREA_NOT_SERVED' });
      continue;
    }
    anyServing = true;
    const blocking: string[] = [];
    let headroom = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      const s = o.stock.get(line.variantId);
      const avail = s?.isListed ? availableOnline(s) : 0;
      if (avail >= line.quantity) availableSomewhere.add(line.variantId);
      if (avail < line.quantity) blocking.push(line.variantId);
      else headroom = Math.min(headroom, avail - line.quantity);
    }
    if (blocking.length > 0) {
      excluded.push({ outletId: o.outletId, reason: 'ITEM_UNAVAILABLE', blockingVariantIds: blocking });
      continue;
    }
    if (subtotalPoisha < o.zoneRule.minOrderPoisha) {
      excluded.push({ outletId: o.outletId, reason: 'MIN_ORDER_NOT_MET' });
      continue;
    }
    const openSlots = o.slots.filter((s) => isSlotBookable(s, now)).sort((a, b) => +a.startsAt - +b.startsAt);
    if (openSlots.length === 0) {
      excluded.push({ outletId: o.outletId, reason: 'NO_SLOTS' });
      continue;
    }
    eligible.push({ outletId: o.outletId, code: o.code, priority: o.zoneRule.priority, headroom, openSlots });
  }

  const unavailableEverywhere = anyServing ? lines.map((l) => l.variantId).filter((v) => !availableSomewhere.has(v)) : [];
  const allLinesSomewhere = anyServing && unavailableEverywhere.length === 0;
  const anyStockEligible = eligible.length > 0 || excluded.some((e) => e.reason === 'MIN_ORDER_NOT_MET' || e.reason === 'NO_SLOTS');

  return {
    eligible: rankOutlets(eligible),
    excluded,
    noSingleOutlet: allLinesSomewhere && !anyStockEligible,
    unavailableEverywhere,
  };
}

/** Order: priority ASC, headroom DESC, code ASC (deterministic). */
export function rankOutlets<T extends Pick<EligibleOutlet, 'priority' | 'headroom' | 'code'>>(outlets: readonly T[]): T[] {
  return [...outlets].sort((a, b) => a.priority - b.priority || b.headroom - a.headroom || a.code.localeCompare(b.code));
}

export interface SlotWindow {
  /** Stable key "startISO|endISO" used by the client to pick a window. */
  slotKey: string;
  startsAt: Date;
  endsAt: Date;
}

export function slotKeyOf(startsAt: Date, endsAt: Date): string {
  return `${startsAt.toISOString()}|${endsAt.toISOString()}`;
}

/** Union of bookable windows across eligible outlets, deduplicated, earliest first. Outlet identity hidden. */
export function slotWindows(eligible: readonly EligibleOutlet[]): SlotWindow[] {
  const map = new Map<string, SlotWindow>();
  for (const o of eligible) {
    for (const s of o.openSlots) {
      const key = slotKeyOf(s.startsAt, s.endsAt);
      if (!map.has(key)) map.set(key, { slotKey: key, startsAt: s.startsAt, endsAt: s.endsAt });
    }
  }
  return [...map.values()].sort((a, b) => +a.startsAt - +b.startsAt);
}

/** Candidates for a chosen window, in the order placement should try them. */
export function candidatesForWindow(eligible: readonly EligibleOutlet[], slotKey: string): { outletId: string; slotId: string }[] {
  const out: { outletId: string; slotId: string }[] = [];
  for (const o of eligible) {
    const s = o.openSlots.find((x) => slotKeyOf(x.startsAt, x.endsAt) === slotKey);
    if (s) out.push({ outletId: o.outletId, slotId: s.slotId });
  }
  return out;
}
