import { describe, expect, it } from 'vitest';
import { applyMovement, availableOnline, movementDelta, StockError } from './inventory.js';
import { candidatesForWindow, evaluateOutlets, rankOutlets, slotWindows, type OutletSnapshot, type SlotSnapshot } from './fulfilment.js';
import { effectivePermissions, PermissionGrantError, PERMISSIONS, ROLE_DEFAULTS } from './permissions.js';

describe('inventory', () => {
  const lvl = { onHand: 10, reserved: 3, onlineBuffer: 2 };

  it('computes online availability with buffer, never negative', () => {
    expect(availableOnline(lvl)).toBe(5);
    expect(availableOnline({ onHand: 2, reserved: 1, onlineBuffer: 5 })).toBe(0);
  });

  it('reserves, commits and releases', () => {
    const r = applyMovement(lvl, 'RESERVE', 5);
    expect(r).toMatchObject({ onHand: 10, reserved: 8 });
    expect(applyMovement(r, 'COMMIT_SALE', 5)).toMatchObject({ onHand: 5, reserved: 3 });
    expect(applyMovement(r, 'RELEASE', 5)).toMatchObject({ onHand: 10, reserved: 3 });
  });

  it('refuses to oversell or break invariants', () => {
    expect(() => applyMovement(lvl, 'RESERVE', 6)).toThrow('insufficient stock');
    expect(() => applyMovement(lvl, 'WRITE_OFF', 8)).toThrow('reserved would exceed on-hand');
    expect(() => applyMovement(lvl, 'ADJUST_DOWN', 11)).toThrow('on-hand would go negative');
    expect(() => applyMovement(lvl, 'RELEASE', 4)).toThrow('reserved would go negative');
    expect(() => applyMovement(lvl, 'RECEIVE', 0)).toThrow(StockError);
    expect(() => applyMovement(lvl, 'RECEIVE', 1.5)).toThrow(StockError);
  });

  it('handles every movement type', () => {
    expect(movementDelta('RECEIVE', 2)).toEqual({ onHand: 2, reserved: 0 });
    expect(movementDelta('ADJUST_UP', 2)).toEqual({ onHand: 2, reserved: 0 });
    expect(movementDelta('RESTOCK_RETURN', 2)).toEqual({ onHand: 2, reserved: 0 });
    expect(movementDelta('TRANSFER_IN', 2)).toEqual({ onHand: 2, reserved: 0 });
    expect(movementDelta('TRANSFER_OUT', 2)).toEqual({ onHand: -2, reserved: 0 });
    expect(movementDelta('RECONCILE', -3)).toEqual({ onHand: -3, reserved: 0 });
  });
});

const now = new Date('2026-11-01T04:00:00Z'); // 10:00 Dhaka
const slot = (id: string, startH: number, patch: Partial<SlotSnapshot> = {}): SlotSnapshot => ({
  slotId: id,
  startsAt: new Date(Date.UTC(2026, 10, 1, startH)),
  endsAt: new Date(Date.UTC(2026, 10, 1, startH + 2)),
  cutoffAt: new Date(Date.UTC(2026, 10, 1, startH - 1)),
  capacity: 10,
  bookedCount: 0,
  status: 'OPEN',
  ...patch,
});
const outlet = (id: string, patch: Partial<OutletSnapshot> = {}): OutletSnapshot => ({
  outletId: id,
  code: id.toUpperCase(),
  status: 'ACTIVE',
  acceptsOnlineOrders: true,
  zoneRule: { active: true, priority: 1, minOrderPoisha: 0 },
  stock: new Map([
    ['milk', { onHand: 10, reserved: 0, onlineBuffer: 0, isListed: true }],
    ['ghee', { onHand: 5, reserved: 0, onlineBuffer: 0, isListed: true }],
  ]),
  slots: [slot(`${id}-s1`, 8), slot(`${id}-s2`, 10)],
  ...patch,
});
const cart = [
  { variantId: 'milk', quantity: 2 },
  { variantId: 'ghee', quantity: 1 },
];

describe('outlet eligibility', () => {
  it('excludes inactive, unserved, out-of-stock, min-order and no-slot outlets with reasons', () => {
    const r = evaluateOutlets(
      [
        outlet('a'),
        outlet('b', { status: 'PAUSED' }),
        outlet('c', { zoneRule: null }),
        outlet('d', { stock: new Map([['milk', { onHand: 10, reserved: 0, onlineBuffer: 0, isListed: true }]]) }),
        outlet('e', { zoneRule: { active: true, priority: 1, minOrderPoisha: 999999 } }),
        outlet('f', { slots: [slot('f1', 8, { bookedCount: 10 }), slot('f2', 10, { cutoffAt: now })] }),
        outlet('g', { acceptsOnlineOrders: false }),
        outlet('h', { zoneRule: { active: false, priority: 1, minOrderPoisha: 0 } }),
      ],
      cart,
      30000,
      now,
    );
    expect(r.eligible.map((e) => e.outletId)).toEqual(['a']);
    expect(Object.fromEntries(r.excluded.map((e) => [e.outletId, e.reason]))).toEqual({
      b: 'INACTIVE',
      c: 'AREA_NOT_SERVED',
      d: 'ITEM_UNAVAILABLE',
      e: 'MIN_ORDER_NOT_MET',
      f: 'NO_SLOTS',
      g: 'INACTIVE',
      h: 'AREA_NOT_SERVED',
    });
    expect(r.excluded.find((e) => e.outletId === 'd')?.blockingVariantIds).toEqual(['ghee']);
    expect(r.noSingleOutlet).toBe(false);
  });

  it('treats stock exactly equal to quantity as available and respects unlisted items', () => {
    const exact = outlet('a', { stock: new Map([['milk', { onHand: 2, reserved: 0, onlineBuffer: 0, isListed: true }], ['ghee', { onHand: 1, reserved: 0, onlineBuffer: 0, isListed: true }]]) });
    expect(evaluateOutlets([exact], cart, 0, now).eligible[0]?.headroom).toBe(0);
    const unlisted = outlet('a', { stock: new Map([['milk', { onHand: 9, reserved: 0, onlineBuffer: 0, isListed: true }], ['ghee', { onHand: 9, reserved: 0, onlineBuffer: 0, isListed: false }]]) });
    expect(evaluateOutlets([unlisted], cart, 0, now).eligible).toEqual([]);
  });

  it('detects "no single outlet" instead of splitting', () => {
    const onlyMilk = outlet('a', { stock: new Map([['milk', { onHand: 9, reserved: 0, onlineBuffer: 0, isListed: true }]]) });
    const onlyGhee = outlet('b', { stock: new Map([['ghee', { onHand: 9, reserved: 0, onlineBuffer: 0, isListed: true }]]) });
    const r = evaluateOutlets([onlyMilk, onlyGhee], cart, 0, now);
    expect(r.eligible).toEqual([]);
    expect(r.noSingleOutlet).toBe(true);
    expect(r.unavailableEverywhere).toEqual([]);
  });

  it('reports items unavailable everywhere', () => {
    const r = evaluateOutlets([outlet('a', { stock: new Map() })], cart, 0, now);
    expect(r.unavailableEverywhere).toEqual(['milk', 'ghee']);
    expect(r.noSingleOutlet).toBe(false);
  });

  it('reports nothing when no outlet serves the area', () => {
    const r = evaluateOutlets([outlet('a', { zoneRule: null })], cart, 0, now);
    expect(r.unavailableEverywhere).toEqual([]);
    expect(r.noSingleOutlet).toBe(false);
  });

  it('ranks by priority, then headroom, then code', () => {
    expect(
      rankOutlets([
        { code: 'B', priority: 2, headroom: 9 },
        { code: 'C', priority: 1, headroom: 1 },
        { code: 'A', priority: 1, headroom: 1 },
        { code: 'D', priority: 1, headroom: 5 },
      ]).map((o) => o.code),
    ).toEqual(['D', 'A', 'C', 'B']);
  });

  it('merges slot windows across outlets without exposing outlets, and orders candidates', () => {
    const a = outlet('a', { zoneRule: { active: true, priority: 2, minOrderPoisha: 0 } });
    const b = outlet('b', { slots: [slot('b-s2', 10), slot('b-s3', 12)] });
    const r = evaluateOutlets([a, b], cart, 0, now);
    const windows = slotWindows(r.eligible);
    expect(windows.map((w) => w.startsAt.getUTCHours())).toEqual([8, 10, 12]);
    expect(Object.keys(windows[0] ?? {})).toEqual(['slotKey', 'startsAt', 'endsAt']);
    const tenAm = windows[1]?.slotKey ?? '';
    expect(candidatesForWindow(r.eligible, tenAm)).toEqual([
      { outletId: 'b', slotId: 'b-s2' },
      { outletId: 'a', slotId: 'a-s2' },
    ]);
    expect(candidatesForWindow(r.eligible, 'nope')).toEqual([]);
  });
});

describe('permissions', () => {
  it('gives super admin everything', () => {
    expect(effectivePermissions('SUPER_ADMIN').size).toBe(PERMISSIONS.length);
  });
  it('adds optional grants within the ceiling only', () => {
    expect(effectivePermissions('OUTLET_STAFF', ['inventory.adjust']).has('inventory.adjust')).toBe(true);
    expect(() => effectivePermissions('OUTLET_STAFF', ['payments.refund'])).toThrow(PermissionGrantError);
    expect(() => effectivePermissions('DELIVERY_STAFF', ['inventory.adjust'])).toThrow(PermissionGrantError);
  });
  it('keeps riders away from money controls', () => {
    const rider = effectivePermissions('DELIVERY_STAFF');
    expect(rider.has('payments.read')).toBe(false);
    expect(rider.has('pricing.manage_global')).toBe(false);
    expect(rider.has('cod.confirm_handover')).toBe(false);
  });
  it('only uses known permission codes in defaults', () => {
    for (const perms of Object.values(ROLE_DEFAULTS)) for (const p of perms) expect(PERMISSIONS).toContain(p);
  });
});
