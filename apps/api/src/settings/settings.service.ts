import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { BULK_CONFIG, DEFAULT_ORDERING_CONFIG, type OrderingConfig } from '@dudhwala/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Typed settings. A missing row yields the default below. Defaults that are not
 * business-approved values say so (`approved: false`) and are shown as
 * placeholders in the admin until the owner saves real ones.
 */
export const SETTINGS = {
  'ordering.hours': {
    schema: z.object({ openMinute: z.number().int().min(0).max(1439), closeMinute: z.number().int().min(1).max(1440) }).refine((h) => h.openMinute < h.closeMinute, 'open must be before close'),
    default: { ...DEFAULT_ORDERING_CONFIG.hours },
  },
  'bulk.rule': {
    schema: z.object({ minTotalQuantity: z.number().int().min(1).max(100_000), minTotalPoisha: z.number().int().min(100).max(10_000_000_000), approved: z.boolean() }),
    default: { minTotalQuantity: BULK_CONFIG.minTotalQuantity, minTotalPoisha: BULK_CONFIG.minTotalPoisha, approved: false },
  },
  /** Outlet where bulk orders are collected (Modina Market Branch). Resolved by outlet code during setup; null until then. */
  'bulk.collectionOutletId': { schema: z.string().uuid().nullable(), default: null as string | null },
  /** Outlet whose stock supplies home delivery. null until the owner names one. */
  'fulfilment.dispatchOutletId': { schema: z.string().uuid().nullable(), default: null as string | null },
  /** Minutes a bulk order waits for its payment before stock is released. */
  'payments.holdMinutes': { schema: z.number().int().min(5).max(240), default: 30 },
  /** Owner-supplied pages (About, FAQ, policies). Text is never written in code. */
  'content.pages': {
    schema: z.array(z.object({ slug: z.string().regex(/^[a-z-]{2,40}$/), titleBn: z.string().min(1).max(120), bodyBn: z.string().min(1).max(20_000) }).strict()).max(30),
    default: [] as { slug: string; titleBn: string; bodyBn: string }[],
  },
  /** Shows the maintenance banner on the storefront. */
  'site.maintenance': { schema: z.boolean(), default: false },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K, tx: Tx = this.prisma): Promise<SettingValue<K>> {
    const row = await tx.setting.findUnique({ where: { key } });
    if (!row) return SETTINGS[key].default as SettingValue<K>;
    const parsed = SETTINGS[key].schema.safeParse(row.value);
    return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
  }

  async set<K extends SettingKey>(key: K, value: SettingValue<K>, actorId: string | null, tx: Tx = this.prisma): Promise<void> {
    const v = SETTINGS[key].schema.parse(value) as Prisma.InputJsonValue;
    await tx.setting.upsert({ where: { key }, create: { key, value: v, updatedById: actorId }, update: { value: v, updatedById: actorId } });
  }

  /** Hours + bulk thresholds in the shape packages/shared expects. */
  async ordering(tx: Tx = this.prisma): Promise<{ config: OrderingConfig; bulkApproved: boolean }> {
    const [hours, bulk] = await Promise.all([this.get('ordering.hours', tx), this.get('bulk.rule', tx)]);
    return { config: { hours, bulk: { minTotalQuantity: bulk.minTotalQuantity, minTotalPoisha: bulk.minTotalPoisha } }, bulkApproved: bulk.approved };
  }
}
