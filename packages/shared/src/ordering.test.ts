import { describe, expect, it } from 'vitest';
import {
  availableFulfilments, bulkStatus, BULK_CONFIG, earliestPickup, orderingStatus, pickupSlots, validateCheckout, validatePickup, zonedParts, zoneEligibility,
  type CheckoutInput, type CheckoutLine,
} from './ordering.js';

// Dhaka is UTC+6: 10:00 Dhaka = 04:00Z, 22:00 Dhaka = 16:00Z
const at = (iso: string) => new Date(iso);
const bakery = { categorySlug: 'bakery' };
const sweetApproved = { categorySlug: 'dairy-sweets', outerCityStatus: 'approved' as const };
const sweetPlain = { categorySlug: 'dairy-sweets' };

describe('zoneEligibility', () => {
  it('In City accepts every category and flag', () => {
    for (const p of [bakery, sweetPlain, sweetApproved, { categorySlug: 'doi-dairy' }, { categorySlug: 'x', outerCityStatus: 'pending_verification' as const }]) expect(zoneEligibility(p, 'IN_CITY').eligible).toBe(true);
  });
  it('Outer City: all Bakery, only approved Dairy Sweets and Doi, nothing else', () => {
    expect(zoneEligibility(bakery, 'OUTER_CITY')).toEqual({ eligible: true, reason: 'category_rule' });
    expect(zoneEligibility(sweetApproved, 'OUTER_CITY')).toEqual({ eligible: true, reason: 'approved_item' });
    expect(zoneEligibility(sweetPlain, 'OUTER_CITY')).toEqual({ eligible: false, reason: 'item_not_approved' });
    expect(zoneEligibility({ categorySlug: 'doi-dairy' }, 'OUTER_CITY')).toEqual({ eligible: false, reason: 'item_not_approved' });
    expect(zoneEligibility({ categorySlug: 'doi-dairy', outerCityStatus: 'approved' }, 'OUTER_CITY').eligible).toBe(true); // the four Doi items confirmed for Outer Sylhet
    expect(zoneEligibility({ categorySlug: 'grocery', outerCityStatus: 'approved' }, 'OUTER_CITY').eligible).toBe(false); // a flag alone never enables a category that is not listed
  });
  it('uncertain flags are never enabled, even inside an eligible category or when ticked', () => {
    expect(zoneEligibility({ categorySlug: 'bakery', outerCityStatus: 'pending_verification' }, 'OUTER_CITY').eligible).toBe(false);
    expect(zoneEligibility({ categorySlug: 'dairy-sweets', outerCityStatus: 'pending_verification' }, 'OUTER_CITY').eligible).toBe(false);
    expect(zoneEligibility({ categorySlug: 'doi-dairy', outerCityStatus: 'pending_confirmation' }, 'OUTER_CITY').eligible).toBe(false);
    expect(zoneEligibility({ categorySlug: 'bakery', outerCityStatus: 'disabled' }, 'OUTER_CITY').eligible).toBe(false);
  });
});

describe('ordering hours (Asia/Dhaka 10:00-22:00)', () => {
  it('is open inside the window and closes at 22:00 sharp', () => {
    expect(orderingStatus(at('2026-03-10T04:00:00Z')).open).toBe(true); // 10:00
    expect(orderingStatus(at('2026-03-10T15:59:00Z')).open).toBe(true); // 21:59
    expect(orderingStatus(at('2026-03-10T16:00:00Z')).open).toBe(false); // 22:00
    expect(orderingStatus(at('2026-03-10T03:59:00Z')).open).toBe(false); // 09:59
  });
  it('reports when ordering reopens', () => {
    expect(orderingStatus(at('2026-03-10T03:00:00Z')).reopensAt?.toISOString()).toBe('2026-03-10T04:00:00.000Z'); // 09:00 -> today 10:00
    expect(orderingStatus(at('2026-03-10T17:00:00Z')).reopensAt?.toISOString()).toBe('2026-03-11T04:00:00.000Z'); // 23:00 -> tomorrow 10:00
    expect(orderingStatus(at('2026-03-10T04:00:00Z')).closesAt?.toISOString()).toBe('2026-03-10T16:00:00.000Z');
  });
  it('uses the zone, not the machine clock', () => {
    expect(zonedParts(at('2026-03-10T18:30:00Z'))).toEqual({ y: 2026, m: 3, d: 11, minutes: 30 }); // 00:30 next day in Dhaka
  });
});

describe('express pickup', () => {
  const now = at('2026-03-10T05:10:00Z'); // 11:10 Dhaka
  it('needs at least one hour of lead time', () => {
    expect(earliestPickup(now).toISOString()).toBe('2026-03-10T06:10:00.000Z');
    expect(validatePickup(now, at('2026-03-10T06:00:00Z'))).toEqual({ ok: false, reason: 'too_soon' });
    expect(validatePickup(now, at('2026-03-10T06:30:00Z'))).toEqual({ ok: true });
    expect(validatePickup(now, null)).toEqual({ ok: false, reason: 'invalid' });
    expect(validatePickup(now, at('2026-03-10T17:00:00Z'))).toEqual({ ok: false, reason: 'outside_hours' });
  });
  it('slots start at or after the earliest pickup, on the step, inside hours', () => {
    const s = pickupSlots(now, 4);
    expect(s[0]?.toISOString()).toBe('2026-03-10T06:30:00.000Z');
    expect(s).toHaveLength(4);
    for (const d of s) expect(d.getTime()).toBeGreaterThanOrEqual(earliestPickup(now).getTime());
  });
  it('late orders get next-day slots', () => {
    const s = pickupSlots(at('2026-03-10T15:30:00Z'), 2); // 21:30 Dhaka: 22:30 is outside hours
    expect(s[0]?.toISOString()).toBe('2026-03-11T04:00:00.000Z');
  });
});

describe('bulk', () => {
  it('qualifies on quantity OR amount, using the configured thresholds', () => {
    const cfg = { minTotalQuantity: 5, minTotalPoisha: 10_000 };
    expect(bulkStatus([{ quantity: 5, linePoisha: 100 }], cfg)).toMatchObject({ isBulk: true, byQuantity: true, byAmount: false });
    expect(bulkStatus([{ quantity: 1, linePoisha: 10_000 }], cfg)).toMatchObject({ isBulk: true, byQuantity: false, byAmount: true });
    expect(bulkStatus([{ quantity: 1, linePoisha: 9_999 }], cfg).isBulk).toBe(false);
  });
  it('an unknown price makes the amount rule "not evaluated", never true', () => {
    const b = bulkStatus([{ quantity: 1, linePoisha: null }]);
    expect(b).toMatchObject({ isBulk: false, byAmount: null, totalPoisha: null });
    expect(bulkStatus([{ quantity: BULK_CONFIG.minTotalQuantity, linePoisha: null }]).isBulk).toBe(true);
  });
  it('bulk carts cannot use delivery or express pickup; the placeholder config is visibly marked', () => {
    expect(availableFulfilments(true)).toEqual(['BULK_ORDER']);
    expect(availableFulfilments(false)).toEqual(['HOME_DELIVERY', 'EXPRESS_PICKUP']);
    expect(availableFulfilments(true)).not.toContain('HOME_DELIVERY');
    expect(BULK_CONFIG.isPlaceholder).toBe(true);
    expect(BULK_CONFIG.collectionBranch.nameEn).toBe('Modina Market Branch');
  });
});

describe('validateCheckout', () => {
  const open = at('2026-03-10T05:00:00Z'); // 11:00 Dhaka
  const line = (key: string, product = bakery, quantity = 1): CheckoutLine => ({ key, product, quantity, linePoisha: null });
  const home = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({ now: open, method: 'HOME_DELIVERY', zone: 'IN_CITY', lines: [line('a')], address: { name: 'রহিম', phone: '01712345678', line1: 'বাসা ১' }, ...over });
  const codes = (i: CheckoutInput) => validateCheckout(i).map((x) => x.code);

  it('accepts a valid home delivery and blocks outside ordering hours', () => {
    expect(codes(home())).toEqual([]);
    expect(codes(home({ now: at('2026-03-10T17:00:00Z') }))).toContain('ordering_closed');
    expect(codes(home({ lines: [] }))).toContain('cart_empty');
  });
  it('Outer City names every ineligible line instead of dropping it', () => {
    const r = validateCheckout(home({ zone: 'OUTER_CITY', lines: [line('ok', bakery), line('bad', sweetPlain), line('ok2', sweetApproved)] }));
    expect(r).toEqual([{ code: 'item_not_deliverable', line: 'bad' }]);
  });
  it('requires a zone and a valid address for delivery', () => {
    expect(codes(home({ zone: null }))).toContain('zone_required');
    expect(codes(home({ address: { name: ' ', phone: '123', line1: '' } }))).toEqual(['address_name_required', 'address_phone_invalid', 'address_line_required']);
  });
  it('pickup needs an outlet and a slot at least one hour away', () => {
    const p = (over: Partial<CheckoutInput>) => ({ now: open, method: 'EXPRESS_PICKUP' as const, zone: null, lines: [line('a')], outletId: 'o1', pickupAt: at('2026-03-10T06:30:00Z'), ...over });
    expect(codes(p({}))).toEqual([]);
    expect(codes(p({ outletId: null }))).toEqual(['outlet_required']);
    expect(codes(p({ pickupAt: at('2026-03-10T05:30:00Z') }))).toEqual(['pickup_too_soon']);
    expect(codes(p({ pickupAt: at('2026-03-10T17:00:00Z') }))).toEqual(['pickup_outside_hours']);
    expect(codes(p({ pickupAt: null }))).toEqual(['pickup_invalid']);
  });
  it('bulk carts must use bulk collection with a (simulated) prepayment', () => {
    const big = [line('a', bakery, BULK_CONFIG.minTotalQuantity)];
    expect(codes(home({ lines: big }))).toContain('bulk_requires_collection');
    expect(codes({ now: open, method: 'EXPRESS_PICKUP', zone: null, lines: big, outletId: 'o', pickupAt: at('2026-03-10T07:00:00Z') })).toContain('bulk_requires_collection');
    expect(codes({ now: open, method: 'BULK_ORDER', zone: null, lines: big })).toEqual(['bulk_prepayment_required']);
    expect(codes({ now: open, method: 'BULK_ORDER', zone: null, lines: big, payment: 'DEMO_PAID_SIMULATED' })).toEqual([]);
    expect(codes({ now: open, method: 'BULK_ORDER', zone: null, lines: [line('a')], payment: 'DEMO_PAID_SIMULATED' })).toContain('not_bulk');
  });
});
