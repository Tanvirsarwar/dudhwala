import { newId } from '../../src/common/crypto.js';
import { SlotGenerator } from '../../src/delivery/delivery-config.service.js';
import { timeOfDay, dhakaDate, dhakaWeekday, addDays } from '../../src/delivery/slots.js';
import { browser, makeOutlet, makeVariant, TEST_ENV, type Harness } from './harness.js';

/** Builds a serviceable world: area → zone → outlet rule → daily slots → stocked products. */
export async function world(h: Harness, opts: { fee?: number; codEnabled?: boolean; capacity?: number; stock?: number; outletCode?: string; priority?: number; area?: { id: string }; zone?: { id: string } } = {}) {
  const area = opts.area ?? (await h.prisma.area.create({ data: { id: newId(), slug: `area-${newId().slice(-8)}`, nameBn: 'জিন্দাবাজার' } }));
  const zone = opts.zone ?? (await h.prisma.deliveryZone.create({ data: { id: newId(), name: 'City core', areas: { create: [{ areaId: area.id }] } } }));
  const outlet = await makeOutlet(h.prisma, opts.outletCode);
  await h.prisma.outlet.update({ where: { id: outlet.id }, data: { acceptsOnlineOrders: true } });
  await h.prisma.outletZoneRule.create({
    data: { outletId: outlet.id, zoneId: zone.id, active: true, priority: opts.priority ?? 100, deliveryFeePoisha: opts.fee ?? 6000, codEnabled: opts.codEnabled ?? true, minOrderPoisha: 0 },
  });
  // One slot window every day 14:00–16:00 Dhaka, cut-off 60 min before.
  for (let wd = 0; wd < 7; wd++) {
    await h.prisma.deliverySlotTemplate.create({ data: { id: newId(), outletId: outlet.id, weekday: wd, startsAt: timeOfDay('14:00'), endsAt: timeOfDay('16:00'), capacity: opts.capacity ?? 10, cutoffMinutes: 60 } });
  }
  await h.app.get(SlotGenerator).generate(outlet.id);
  const milk = await makeVariant(h.prisma);
  const ghee = await makeVariant(h.prisma);
  for (const v of [milk, ghee]) {
    await h.prisma.inventory.create({ data: { id: newId(), outletId: outlet.id, productVariantId: v.id, quantityOnHand: opts.stock ?? 10, isListed: true } });
  }
  return { area, zone, outlet, milk, ghee };
}

export async function stock(h: Harness, outletId: string, variantId: string, onHand: number) {
  await h.prisma.inventory.upsert({
    where: { outletId_productVariantId: { outletId, productVariantId: variantId } },
    update: { quantityOnHand: onHand },
    create: { id: newId(), outletId, productVariantId: variantId, quantityOnHand: onHand, isListed: true },
  });
}

let phoneSeq = 10_000_000;
export async function customer(h: Harness) {
  const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
  const phone = `017${String(phoneSeq++).padStart(8, '0')}`;
  const r = await agent.post('/v1/auth/otp/request').send({ phone }).expect(200);
  await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
  h.clock.advance(61_000);
  return { agent, phone: `+88${phone}` };
}

export const address = (areaId: string) => ({ recipientName: 'TEST Customer', phone: '01712345678', areaId, line1: 'House 1, Road 2' });

/** Quote → price → place. Returns the placement response body. */
export async function placeOrder(agent: Awaited<ReturnType<typeof browser>>, areaId: string, method: 'COD' | 'ONLINE', opts: { key?: string; coupon?: string; expect?: number } = {}) {
  const q = await agent.post('/v1/checkout/quote').send({ areaId }).expect(200);
  const slotKey = q.body.slots[0]?.slotKey as string;
  const price = await agent.post('/v1/checkout/price').send({ areaId, slotKey, paymentMethod: method, couponCode: opts.coupon ?? null }).expect(200);
  const res = await agent
    .post('/v1/checkout/orders')
    .set('idempotency-key', opts.key ?? newId())
    .send({ address: address(areaId), slotKey, paymentMethod: method, couponCode: opts.coupon ?? null, quoteHash: price.body.quoteHash, acceptedPolicyVersion: 'v1' })
    .expect(opts.expect ?? 201);
  return { ...res.body, slotKey, quote: q.body, price: price.body } as { orderId: string; orderNumber: string; status: string; paymentStatus: string; next: string; slotKey: string; quote: { slots: { slotKey: string }[] }; price: { totalPoisha: number; quoteHash: string } };
}

export async function enableOnline(h: Harness) {
  await h.prisma.setting.deleteMany({ where: { key: 'payments.online.enabled' } });
  await h.prisma.setting.create({ data: { id: newId(), key: 'payments.online.enabled', scope: 'GLOBAL', value: true } });
}

export function todayPlus(h: Harness, days: number) {
  const d = addDays(dhakaDate(h.clock.now()), days);
  return { date: d, weekday: dhakaWeekday(d) };
}
