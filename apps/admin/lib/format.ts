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

export function dateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const p = dhakaParts(iso);
  return `${p.y}-${two(p.m)}-${two(p.day)} ${two(p.h)}:${two(p.min)}`;
}

export function time(iso: string | Date): string {
  const p = dhakaParts(iso);
  return `${two(p.h)}:${two(p.min)}`;
}

import { ORDER_STATUS_BN as DEMO_STATUS_BN, ORDER_STATUS_LABEL_BN } from '@dudhwala/shared';

export { METHOD_BN, ORDER_STATUS_FLOW } from '@dudhwala/shared';
/** Labels for demo (DEMO_*) and live statuses. */
export const ORDER_STATUS_BN: Record<string, string> = { ...DEMO_STATUS_BN, ...ORDER_STATUS_LABEL_BN };

export const PAYMENT_BN: Record<string, string> = {
  NOT_REQUIRED_DEMO: 'ক্যাশ অন ডেলিভারি / আউটলেটে (ডেমো)',
  DEMO_UNPAID: 'ডেমো/সিমুলেটেড পেমেন্ট — বাকি',
  DEMO_PAID_SIMULATED: 'ডেমো/সিমুলেটেড পেমেন্ট — সম্পন্ন',
  NOT_REQUIRED: 'ডেলিভারি/পিকআপের সময় পরিশোধ',
  PENDING: 'পেমেন্টের অপেক্ষায়',
  PAID: 'পেমেন্ট যাচাই হয়েছে',
  FAILED: 'পেমেন্ট ব্যর্থ',
};

export const ROLE_BN: Record<string, string> = { ADMIN: 'অ্যাডমিন', MANAGER: 'ম্যানেজার' };
