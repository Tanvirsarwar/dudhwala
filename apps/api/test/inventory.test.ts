import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { loginStaff, makeOutlet, makeStaff, makeVariant, resetDb, startHarness, type Harness } from './support/harness.js';

let h: Harness;
let inv: InventoryService;
beforeAll(async () => {
  h = await startHarness();
  inv = h.app.get(InventoryService);
});
afterAll(async () => h.close());
beforeEach(async () => resetDb(h.prisma));

async function setup(onHand: number, opts: { buffer?: number } = {}) {
  const outlet = await makeOutlet(h.prisma);
  const variant = await makeVariant(h.prisma);
  const mgr = await loginStaff(h, await makeStaff(h.prisma, 'OUTLET_MANAGER', outlet.id));
  await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/receive`).send({ variantId: variant.id, qty: onHand }).expect(201);
  await h.prisma.inventory.update({
    where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } },
    data: { isListed: true, onlineBufferQty: opts.buffer ?? 0 },
  });
  return { outlet, variant, mgr };
}

describe('inventory', () => {
  it('records every change as a movement with actor and after-quantities', async () => {
    const { outlet, variant, mgr } = await setup(10);
    await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/adjust`).send({ variantId: variant.id, deltaQty: -3, reason: 'count correction' }).expect(201);
    await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/write-off`).send({ variantId: variant.id, qty: 2, reason: 'spoiled' }).expect(201);
    const mv = await h.prisma.stockMovement.findMany({ where: { outletId: outlet.id }, orderBy: { createdAt: 'asc' } });
    expect(mv.map((m) => [m.type, m.qtyDeltaOnHand, m.onHandAfter])).toEqual([
      ['RECEIVE', 10, 10],
      ['ADJUST_DOWN', -3, 7],
      ['WRITE_OFF', -2, 5],
    ]);
    expect(mv.every((m) => m.actorUserId)).toBe(true);
    expect(await h.prisma.auditLog.count({ where: { outletId: outlet.id, action: { startsWith: 'inventory.' } } })).toBe(3);
  });

  it('refuses to make stock negative', async () => {
    const { outlet, variant, mgr } = await setup(2);
    const r = await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/adjust`).send({ variantId: variant.id, deltaQty: -3, reason: 'oops' }).expect(409);
    expect(r.body.error.details).toEqual({ onHand: 2, reserved: 0 });
  });

  it('requires a reason for manual changes', async () => {
    const { outlet, variant, mgr } = await setup(2);
    await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/adjust`).send({ variantId: variant.id, deltaQty: 1 }).expect(400);
  });

  it('does not allow write-off below reserved quantity', async () => {
    const { outlet, variant, mgr } = await setup(5);
    await inv.run((tx) => inv.reserveLines(tx, outlet.id, [{ variantId: variant.id, qty: 4 }], null));
    await mgr.post(`/v1/admin/outlets/${outlet.id}/inventory/write-off`).send({ variantId: variant.id, qty: 2, reason: 'damaged' }).expect(409);
  });

  it('never oversells under 20 concurrent reservations (with online buffer)', async () => {
    const { outlet, variant } = await setup(7, { buffer: 2 }); // 5 sellable online
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => inv.run((tx) => inv.reserveLines(tx, outlet.id, [{ variantId: variant.id, qty: 1 }], null))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => (r.reason as { code?: string }).code === 'OUT_OF_STOCK')).toBe(true);
    const row = await h.prisma.inventory.findUniqueOrThrow({ where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } } });
    expect([row.quantityOnHand, row.reservedQuantity]).toEqual([7, 5]);
    expect(await h.prisma.stockMovement.count({ where: { outletId: outlet.id, type: 'RESERVE' } })).toBe(5);
  });

  it('rolls back all lines when one line is short (all-or-nothing)', async () => {
    const { outlet, variant } = await setup(5);
    const other = await makeVariant(h.prisma);
    await expect(
      inv.run((tx) => inv.reserveLines(tx, outlet.id, [{ variantId: variant.id, qty: 2 }, { variantId: other.id, qty: 1 }], null)),
    ).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    const row = await h.prisma.inventory.findUniqueOrThrow({ where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } } });
    expect(row.reservedQuantity).toBe(0);
  });

  it('does not reserve unlisted items', async () => {
    const { outlet, variant } = await setup(5);
    await h.prisma.inventory.update({ where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } }, data: { isListed: false } });
    await expect(inv.run((tx) => inv.reserveLines(tx, outlet.id, [{ variantId: variant.id, qty: 1 }], null))).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
  });

  it('keeps stock separate per outlet', async () => {
    const a = await setup(3);
    const b = await makeOutlet(h.prisma);
    await expect(inv.run((tx) => inv.reserveLines(tx, b.id, [{ variantId: a.variant.id, qty: 1 }], null))).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
  });

  it('detects concurrent edits of inventory settings', async () => {
    const { outlet, variant, mgr } = await setup(3);
    const list = await mgr.get(`/v1/admin/outlets/${outlet.id}/inventory`).expect(200);
    const version = list.body[0].version as number;
    await mgr.patch(`/v1/admin/outlets/${outlet.id}/inventory/${variant.id}`).send({ lowStockThreshold: 2, expectedVersion: version }).expect(200);
    const r = await mgr.patch(`/v1/admin/outlets/${outlet.id}/inventory/${variant.id}`).send({ lowStockThreshold: 3, expectedVersion: version }).expect(409);
    expect(r.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('enforces append-only history at the database level', async () => {
    const { outlet } = await setup(1);
    const m = await h.prisma.stockMovement.findFirstOrThrow({ where: { outletId: outlet.id } });
    await expect(h.prisma.stockMovement.update({ where: { id: m.id }, data: { reason: 'tampered' } })).rejects.toThrow(/append-only/);
    await expect(h.prisma.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    const a = await h.prisma.auditLog.findFirstOrThrow();
    await expect(h.prisma.auditLog.delete({ where: { id: a.id } })).rejects.toThrow(/append-only/);
  });

  it('database CHECK constraints reject impossible stock even if app code is bypassed', async () => {
    const { outlet, variant } = await setup(1);
    await expect(
      h.prisma.inventory.update({ where: { outletId_productVariantId: { outletId: outlet.id, productVariantId: variant.id } }, data: { reservedQuantity: 2 } }),
    ).rejects.toThrow();
  });
});
