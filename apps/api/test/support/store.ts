import { newId } from '../../src/common/crypto.js';
import { timeOfDay } from '../../src/delivery/slots.js';
import { SlotGenerator } from '../../src/delivery/delivery-config.service.js';
import { browser, loginStaff, makeStaff, TEST_ENV, type Harness } from './harness.js';

let n = 0;
const u = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export interface StoreOpts {
  stock?: number;
  capacity?: number;
  feeTaka?: number;
  freeAboveTaka?: number | null;
  minOrderTaka?: number;
  cod?: boolean;
  codMaxTaka?: number | null;
  onlineEnabled?: boolean;
  autoConfirm?: boolean;
  priority?: number;
  outletCode?: string;
  zoneId?: string;
  areaId?: string;
}

/**
 * A fully configured outlet that can take orders: area → zone → outlet rule,
 * slot templates (14:00–16:00 and 18:00–20:00 Dhaka, every day, 60-min cut-off),
 * generated slots, and listed stock for the given variants.
 */
export async function makeOutletReady(h: Harness, variantIds: string[], o: StoreOpts = {}) {
  const p = h.prisma;
  const areaId = o.areaId ?? (await p.area.create({ data: { id: newId(), slug: `area-${u()}`, nameBn: 'জিন্দাবাজার' } })).id;
  const zoneId =
    o.zoneId ??
    (await (async () => {
      const z = await p.deliveryZone.create({ data: { id: newId(), name: `zone-${u()}` } });
      await p.deliveryZoneArea.create({ data: { zoneId: z.id, areaId } });
      return z.id;
    })());
  const outlet = await p.outlet.create({
    data: { id: newId(), code: o.outletCode ?? `O-${u()}`.toUpperCase().slice(0, 16), nameBn: 'টেস্ট আউটলেট', addressLine: 'TEST', status: 'ACTIVE', acceptsOnlineOrders: true, autoConfirmOrders: o.autoConfirm ?? false },
  });
  await p.outletZoneRule.create({
    data: {
      outletId: outlet.id,
      zoneId,
      active: true,
      priority: o.priority ?? 100,
      deliveryFeePoisha: (o.feeTaka ?? 60) * 100,
      freeDeliveryMinPoisha: o.freeAboveTaka === undefined ? null : o.freeAboveTaka === null ? null : o.freeAboveTaka * 100,
      minOrderPoisha: (o.minOrderTaka ?? 0) * 100,
      codEnabled: o.cod ?? true,
      codMaxOrderPoisha: o.codMaxTaka ? o.codMaxTaka * 100 : null,
    },
  });
  for (let wd = 0; wd < 7; wd++) {
    for (const [s, e] of [['14:00', '16:00'], ['18:00', '20:00']] as const) {
      await p.deliverySlotTemplate.create({ data: { id: newId(), outletId: outlet.id, weekday: wd, startsAt: timeOfDay(s), endsAt: timeOfDay(e), capacity: o.capacity ?? 5, cutoffMinutes: 60 } });
    }
  }
  await h.app.get(SlotGenerator).generate(outlet.id);
  for (const v of variantIds) {
    await p.inventory.create({ data: { id: newId(), outletId: outlet.id, productVariantId: v, quantityOnHand: o.stock ?? 10, isListed: true } });
  }
  if (o.onlineEnabled !== false && !(await p.setting.findFirst({ where: { key: 'payments.online.enabled', outletId: null } }))) {
    await p.setting.create({ data: { id: newId(), key: 'payments.online.enabled', scope: 'GLOBAL', value: true } });
  }
  return { outlet, areaId, zoneId };
}

/** Published product with variants (prices in taka). */
export async function makeProduct(h: Harness, prices: number[], name = 'TEST দই') {
  const p = h.prisma;
  const cat = await p.category.create({ data: { id: newId(), slug: `cat-${u()}`, nameBn: 'দুগ্ধজাত' } });
  const product = await p.product.create({ data: { id: newId(), categoryId: cat.id, slug: `prod-${u()}`, nameBn: name, nameEn: 'Test Doi', status: 'ACTIVE' } });
  const variants = [];
  for (const [i, taka] of prices.entries()) {
    variants.push(
      await p.productVariant.create({ data: { id: newId(), productId: product.id, sku: `SKU-${u()}`.toUpperCase(), labelBn: `${i + 1} কেজি`, packSize: i + 1, packUnit: 'KG', pricePoisha: taka * 100, status: 'ACTIVE', sortOrder: i } }),
    );
  }
  return { product, variants, category: cat };
}

let phoneSeq = 0;
/** Logged-in customer agent (storefront origin, audience header set). */
export async function customer(h: Harness, phone?: string) {
  const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
  agent.set('x-dw-audience', 'customer');
  const ph = phone ?? `0171${String(1000000 + phoneSeq++).slice(-7)}`;
  h.clock.advance(61_000); // OTP resend spacing
  const r = await agent.post('/v1/auth/otp/request').send({ phone: ph }).expect(200);
  const v = await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
  return Object.assign(agent, { userId: v.body.user.id as string, phone: ph });
}

export async function staffAt(h: Harness, role: 'OUTLET_MANAGER' | 'OUTLET_STAFF' | 'DELIVERY_STAFF', outletId: string, extra: string[] = []) {
  const s = await makeStaff(h.prisma, role, outletId, { extraPermissions: extra });
  return Object.assign(await loginStaff(h, s), { userId: s.user.id });
}

export async function superAdmin(h: Harness) {
  const s = await makeStaff(h.prisma, 'SUPER_ADMIN', null);
  return Object.assign(await loginStaff(h, s), { userId: s.user.id });
}

export const address = (areaId: string) => ({ recipientName: 'রহিম', phone: '01811111111', areaId, line1: 'বাসা ১২, রোড ৩', landmark: 'মসজিদের পাশে' });

let keySeq = 0;
export const idemKey = () => `test-key-${Date.now()}-${keySeq++}-abcdef`;

/** Quote → price → place. Returns the placed order response. */
export async function checkoutFlow(agent: Awaited<ReturnType<typeof customer>>, areaId: string, method: 'COD' | 'ONLINE', opts: { slotIndex?: number; coupon?: string; expect?: number } = {}) {
  const q = await agent.post('/v1/checkout/quote').send({ areaId }).expect(200);
  const slot = q.body.slots[opts.slotIndex ?? 0];
  if (!slot) throw new Error(`no slot: ${JSON.stringify(q.body)}`);
  const pr = await agent.post('/v1/checkout/price').send({ areaId, slotKey: slot.slotKey, paymentMethod: method, couponCode: opts.coupon ?? null }).expect(200);
  const res = await agent
    .post('/v1/checkout/orders')
    .set('idempotency-key', idemKey())
    .send({ address: address(areaId), slotKey: slot.slotKey, paymentMethod: method, couponCode: opts.coupon ?? null, quoteHash: pr.body.quoteHash, acceptedPolicyVersion: '2026-10' });
  if (opts.expect !== undefined) {
    if (res.status !== opts.expect) throw new Error(`expected ${opts.expect}, got ${res.status}: ${JSON.stringify(res.body)}`);
  } else if (res.status !== 201) {
    throw new Error(`place failed ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { quote: q.body, price: pr.body, placed: res.body, slot, status: res.status };
}
