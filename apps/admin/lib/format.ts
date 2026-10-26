import { formatTaka, parseTaka } from '@dudhwala/shared';

/** Admin uses Latin numerals for data-entry speed (UI_UX_SPEC §4). */
export const taka = (poisha: number | null | undefined) => (poisha == null ? '—' : formatTaka(poisha, 'en'));

/** "1,250.50" or "১২৫০" → poisha; null when empty or invalid. */
export function toPoisha(input: string): number | null {
  if (!input.trim()) return null;
  try {
    return parseTaka(input);
  } catch {
    return null;
  }
}

export const poishaToInput = (p: number | null | undefined) => (p == null ? '' : (p / 100).toFixed(p % 100 === 0 ? 0 : 2));

/** Asia/Dhaka is UTC+6 all year (no DST). */
function dhakaParts(iso: string | Date) {
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}
const two = (n: number) => String(n).padStart(2, '0');

export function todayDhaka(): string {
  const p = dhakaParts(new Date());
  return `${p.y}-${two(p.m)}-${two(p.day)}`;
}

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const p = dhakaParts(iso);
  return `${p.y}-${two(p.m)}-${two(p.day)} ${two(p.h)}:${two(p.min)}`;
}

export function time(iso: string | Date): string {
  const p = dhakaParts(iso);
  return `${two(p.h)}:${two(p.min)}`;
}

export const slot = (start: string, end: string) => `${dateTime(start).slice(0, 10)} ${time(start)}–${time(end)}`;

export const ORDER_STATUS: Record<string, string> = {
  PENDING_PAYMENT: 'পেমেন্টের অপেক্ষায়',
  PLACED: 'নতুন',
  CONFIRMED: 'নিশ্চিত',
  PREPARING: 'প্রস্তুত হচ্ছে',
  READY_FOR_DISPATCH: 'পাঠানোর জন্য প্রস্তুত',
  OUT_FOR_DELIVERY: 'ডেলিভারির পথে',
  DELIVERED: 'ডেলিভারি সম্পন্ন',
  DELIVERY_FAILED: 'ডেলিভারি ব্যর্থ',
  CANCELLED: 'বাতিল',
  REJECTED: 'প্রত্যাখ্যাত',
  EXPIRED: 'মেয়াদোত্তীর্ণ',
};

/** Button labels for moving an order into each status. */
export const TRANSITION_LABEL: Record<string, string> = {
  CONFIRMED: 'নিশ্চিত করুন',
  REJECTED: 'প্রত্যাখ্যান',
  PREPARING: 'প্রস্তুত শুরু',
  READY_FOR_DISPATCH: 'প্রস্তুত — পাঠানো যাবে',
  OUT_FOR_DELIVERY: 'রাইডারের হাতে দিন',
  DELIVERED: 'ডেলিভারি সম্পন্ন',
  DELIVERY_FAILED: 'ডেলিভারি ব্যর্থ',
  CANCELLED: 'বাতিল',
};

export const PAYMENT_STATUS: Record<string, string> = {
  UNPAID: 'বাকি',
  PENDING: 'যাচাই হচ্ছে',
  PAID: 'পরিশোধিত',
  FAILED: 'ব্যর্থ',
  CANCELLED: 'বাতিল',
  PARTIALLY_REFUNDED: 'আংশিক ফেরত',
  REFUNDED: 'ফেরত',
};

export const COD_STATUS: Record<string, string> = {
  PENDING: 'সংগ্রহ বাকি',
  COLLECTED: 'রাইডারের কাছে',
  HANDED_OVER: 'জমা হয়েছে',
  DISCREPANCY: 'গরমিল',
  NOT_COLLECTED: 'সংগ্রহ হয়নি',
};

export const ROLE: Record<string, string> = {
  SUPER_ADMIN: 'সুপার অ্যাডমিন',
  OUTLET_MANAGER: 'আউটলেট ম্যানেজার',
  OUTLET_STAFF: 'আউটলেট স্টাফ',
  DELIVERY_STAFF: 'ডেলিভারি রাইডার',
};

export const WEEKDAYS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহস্পতি', 'শুক্র', 'শনি'];

/** Reasons the order transition endpoint requires. */
export const NEEDS_REASON = new Set(['REJECTED', 'CANCELLED', 'DELIVERY_FAILED']);
