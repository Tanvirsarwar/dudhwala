import { newId } from '../../src/common/crypto.js';
import { browser, TEST_ENV, type Harness } from './harness.js';
import type { Prisma } from '../../src/generated/prisma/client.js';

let n = 0;
const u = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export interface Shop {
  /** Dispatch outlet (home delivery) and bulk collection outlet; the same outlet unless `separateCollection` is set. */
  outlet: { id: string; code: string };
  collection: { id: string; code: string };
}

/** Outlet(s) wired up the way the owner's setup file would: dispatch + bulk collection outlet configured. */
export async function makeShop(h: Harness, opts: { separateCollection?: boolean } = {}): Promise<Shop> {
  const mk = async (code: string, name: string) => h.prisma.outlet.create({ data: { id: newId(), code, nameBn: name, nameEn: name, addressLine: 'TEST address', status: 'ACTIVE' } });
  const outlet = await mk(`MAIN-${u()}`.toUpperCase(), 'Main');
  const collection = opts.separateCollection ? await mk(`MODINA-${u()}`.toUpperCase(), 'Modina Market Branch') : outlet;
  await h.prisma.setting.createMany({
    data: [
      { key: 'fulfilment.dispatchOutletId', value: outlet.id },
      { key: 'bulk.collectionOutletId', value: collection.id },
    ],
    skipDuplicates: true,
  });
  return { outlet, collection };
}

export interface ProductOpts {
  slug?: string;
  category?: string;
  priceTaka?: number | null;
  stock?: number | 'untracked' | null;
  outer?: 'APPROVED' | 'DISABLED' | 'PENDING_VERIFICATION' | 'PENDING_CONFIRMATION' | null;
  active?: boolean;
  maxQty?: number;
  outletId?: string;
}

/** A product with one variant. `stock` is units at `outletId` (default: none counted -> out of stock); 'untracked' = stock not counted. */
export async function makeProduct(h: Harness, o: ProductOpts = {}) {
  const p = h.prisma;
  const catSlug = o.category ?? 'doi-dairy';
  const cat = (await p.category.findUnique({ where: { slug: catSlug } })) ?? (await p.category.create({ data: { id: newId(), slug: catSlug, nameBn: 'ক্যাটাগরি', nameEn: catSlug } }));
  const product = await p.product.create({
    data: { id: newId(), categoryId: cat.id, slug: o.slug ?? `prod-${u()}`, nameBn: 'টেস্ট পণ্য', nameEn: 'Test product', nameVerified: true, active: o.active ?? true, outerCityStatus: o.outer ?? null },
  });
  const variant = await p.productVariant.create({
    data: {
      id: newId(),
      productId: product.id,
      labelBn: '১ কেজি',
      pricePoisha: o.priceTaka === null ? null : (o.priceTaka ?? 100) * 100,
      maxQty: o.maxQty ?? 999,
      trackStock: o.stock !== 'untracked',
    },
  });
  if (typeof o.stock === 'number') {
    if (!o.outletId) throw new Error('stock needs outletId');
    await p.inventory.create({ data: { id: newId(), outletId: o.outletId, productVariantId: variant.id, quantityOnHand: o.stock } });
  }
  return { product, variant };
}

let phoneSeq = 0;
/** Signed-in customer agent (storefront origin, audience header set). */
export async function customer(h: Harness, phone?: string) {
  const agent = await browser(h.app, TEST_ENV.WEB_ORIGIN);
  agent.set('x-dw-audience', 'customer');
  const ph = phone ?? `0171${String(1000000 + phoneSeq++).slice(-7)}`;
  h.clock.advance(61_000); // OTP resend spacing
  const r = await agent.post('/v1/auth/otp/request').send({ phone: ph }).expect(200);
  const v = await agent.post('/v1/auth/otp/verify').send({ challengeId: r.body.challengeId, code: h.sms.lastCode() }).expect(200);
  return Object.assign(agent, { userId: v.body.user.id as string, phone: ph });
}

let keySeq = 0;
export const idemKey = () => `test-key-${Date.now()}-${keySeq++}-abcdef`;

export const home = (lines: { variantId: string; quantity: number }[], zone: 'IN_CITY' | 'OUTER_CITY' = 'IN_CITY') => ({
  method: 'HOME_DELIVERY',
  zone,
  lines,
  address: { name: 'রহিম', phone: '01811111111', line1: 'বাসা ১২, রোড ৩, সিলেট', landmark: 'মসজিদের পাশে' },
});

export const pickup = (lines: { variantId: string; quantity: number }[], outletId: string, pickupAt: Date) => ({
  method: 'EXPRESS_PICKUP',
  lines,
  contact: { name: 'করিম', phone: '01911111111' },
  outletId,
  pickupAt: pickupAt.toISOString(),
});

export const bulk = (lines: { variantId: string; quantity: number }[]) => ({ method: 'BULK_ORDER', lines, contact: { name: 'কোম্পানি', phone: '01711111111' } });

export type CustomerAgent = Awaited<ReturnType<typeof customer>>;
export const postOrder = (c: CustomerAgent, body: unknown, key = idemKey()) => c.post('/v1/orders').set('idempotency-key', key).send(body as object);

export type { Prisma };
