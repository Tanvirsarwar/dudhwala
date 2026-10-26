import { z } from 'zod';

/**
 * Typed business settings (DATABASE_SCHEMA §11 `setting`). Defaults are
 * deliberately "off"/empty so nothing invented reaches customers
 * (OPEN_DECISIONS). Each key declares where it may be set.
 */
export const SETTINGS = {
  'payments.online.enabled': { scope: 'GLOBAL', schema: z.boolean(), default: false, doc: 'Show online payment at checkout (E1)' },
  'payments.holdMinutes': { scope: 'GLOBAL', schema: z.number().int().min(5).max(60), default: 15, doc: 'Unpaid online order hold before release (E7)' },
  'cod.failedDeliveryBlockThreshold': { scope: 'GLOBAL', schema: z.number().int().min(1).max(10).nullable(), default: null, doc: 'Block COD after N failed deliveries (E4)' },
  'delivery.bookingHorizonDays': { scope: 'GLOBAL', schema: z.number().int().min(1).max(14), default: 3, doc: 'How many days ahead slots are offered' },
  'delivery.maxAttempts': { scope: 'GLOBAL', schema: z.number().int().min(1).max(5), default: 2, doc: 'Delivery attempts before an order closes as failed (D8)' },
  'orders.customerCancelUntil': { scope: 'GLOBAL', schema: z.enum(['PLACED', 'CONFIRMED']), default: 'CONFIRMED', doc: 'Last status a customer may self-cancel (D9)' },
  'orders.maxPendingPaymentPerCustomer': { scope: 'GLOBAL', schema: z.number().int().min(1).max(5), default: 2, doc: 'Abuse limit (SECURITY_REVIEW §7)' },
  'sms.events': {
    scope: 'GLOBAL',
    schema: z.array(z.enum(['PLACED', 'CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'REFUNDED'])).max(6),
    default: ['PLACED', 'OUT_FOR_DELIVERY'],
    doc: 'Order events that send an SMS (F4)',
  },
  'storefront.popularMinOrders': { scope: 'GLOBAL', schema: z.number().int().min(1).max(10_000), default: 50, doc: 'Real orders needed before a "popular" section shows' },
  'inventory.transfers.enabled': { scope: 'GLOBAL', schema: z.boolean(), default: false, doc: 'Allow stock transfers between outlets (C4)' },
  'storefront.maintenance': { scope: 'GLOBAL', schema: z.boolean(), default: false, doc: 'Maintenance mode for incidents (DEPLOYMENT_RUNBOOK §8)' },
  'orders.lateAfterMinutes': { scope: 'OUTLET', schema: z.number().int().min(0).max(240), default: 15, doc: 'Flag an order late this long after slot end' },
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]['schema']>;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}
