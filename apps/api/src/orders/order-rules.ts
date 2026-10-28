import { bulkStatus, orderingStatus, hoursOf, tryNormalizeBdMobile, validatePickup, zoneEligibility, PICKUP_RULES, type DeliveryZone, type FulfilmentMethod, type OrderingConfig } from '@dudhwala/shared';
import { AppError } from '../common/errors.js';
import type { OuterCityStatus } from '../generated/prisma/client.js';
import { outerToApi } from '../catalog/catalog.service.js';

export interface RuleLine {
  variantId: string;
  nameBn: string;
  categorySlug: string;
  outerCityStatus: OuterCityStatus | null;
  quantity: number;
  unitPricePoisha: number;
}

export interface RuleInput {
  now: Date;
  method: FulfilmentMethod;
  zone: DeliveryZone | null;
  lines: RuleLine[];
  config: OrderingConfig;
  contact: { name: string; phone: string; line1?: string | null };
  /** For EXPRESS_PICKUP: is the outlet open at the requested pickup instant? */
  pickup?: { at: Date | null; outletOpen: (at: Date) => boolean } | undefined;
}

export const MAX_PICKUP_DAYS = 7;

/**
 * The server-side business rules, in one place and free of I/O so they can be tested exhaustively.
 * Throws the first violated rule as an AppError. The storefront runs the same shared helpers for fast
 * feedback; this function is the one that counts.
 */
export function assertOrderRules(i: RuleInput): { isBulk: boolean; subtotalPoisha: number; phone: string } {
  if (!orderingStatus(i.now, hoursOf(i.config)).open) throw new AppError('ORDERING_CLOSED', 'এখন অর্ডার নেওয়া বন্ধ আছে', orderingStatus(i.now, hoursOf(i.config)));

  const name = i.contact.name.trim();
  const phone = tryNormalizeBdMobile(i.contact.phone);
  if (!name) throw new AppError('VALIDATION_FAILED', 'Name is required');
  if (!phone) throw new AppError('VALIDATION_FAILED', 'Invalid Bangladeshi mobile number');

  const subtotalPoisha = i.lines.reduce((s, l) => s + l.unitPricePoisha * l.quantity, 0);
  const bulk = bulkStatus(i.lines.map((l) => ({ quantity: l.quantity, linePoisha: l.unitPricePoisha * l.quantity })), i.config.bulk);
  if (bulk.isBulk && i.method !== 'BULK_ORDER') throw new AppError('BULK_REQUIRED', 'এই অর্ডার বাল্ক — বাল্ক অর্ডার হিসেবে দিন', bulk);
  if (!bulk.isBulk && i.method === 'BULK_ORDER') throw new AppError('NOT_BULK', 'বাল্ক অর্ডারের জন্য যথেষ্ট পণ্য নেই', bulk);

  if (i.method === 'HOME_DELIVERY') {
    if (!i.zone) throw new AppError('ZONE_REQUIRED', 'ডেলিভারি জোন বেছে নিন');
    if (!i.contact.line1?.trim()) throw new AppError('VALIDATION_FAILED', 'Delivery address is required');
    const bad = i.lines.filter((l) => !zoneEligibility({ categorySlug: l.categorySlug, outerCityStatus: outerToApi(l.outerCityStatus) }, i.zone as DeliveryZone).eligible);
    if (bad.length) throw new AppError('NOT_DELIVERABLE', 'কিছু পণ্য এই জোনে ডেলিভারি করা যাবে না', bad.map((l) => ({ variantId: l.variantId, nameBn: l.nameBn })));
  }

  if (i.method === 'EXPRESS_PICKUP') {
    const check = validatePickup(i.now, i.pickup?.at ?? null, { ...PICKUP_RULES, hours: { timeZone: 'Asia/Dhaka', openMinute: 0, closeMinute: 24 * 60 } });
    if (!check.ok && check.reason !== 'outside_hours') throw new AppError('PICKUP_INVALID', 'পিকআপের সময় সঠিক নয় (কমপক্ষে ১ ঘণ্টা পরে হতে হবে)', { reason: check.reason });
    const at = i.pickup?.at as Date;
    if (at.getTime() > i.now.getTime() + MAX_PICKUP_DAYS * 86_400_000) throw new AppError('PICKUP_INVALID', 'পিকআপের সময় অনেক দূরে', { reason: 'too_far' });
    if (!i.pickup?.outletOpen(at)) throw new AppError('PICKUP_INVALID', 'আউটলেট এই সময়ে খোলা থাকে না', { reason: 'outside_hours' });
  }
  return { isBulk: bulk.isBulk, subtotalPoisha, phone };
}
