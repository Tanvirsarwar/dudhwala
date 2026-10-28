import { formatTaka } from '@dudhwala/shared';

/** Price text. A missing price is shown as pending, never guessed. */
export const PRICE_PENDING = 'দাম শীঘ্রই জানানো হবে';
export const taka = (poisha: number | null) => (poisha === null ? PRICE_PENDING : formatTaka(poisha, 'bn'));

const BN = '০১২৩৪৫৬৭৮৯';
export const bnDigits = (s: string | number) => String(s).replace(/\d/g, (d) => BN[Number(d)] ?? d);

const DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];

/** Wall-clock parts in Asia/Dhaka (fixed UTC+6, no DST). */
function dhaka(iso: string | Date) {
  const d = new Date(new Date(iso).getTime() + 6 * 3_600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), wd: d.getUTCDay(), h: d.getUTCHours(), min: d.getUTCMinutes() };
}

export function dayLabel(iso: string | Date): string {
  const p = dhaka(iso);
  return `${DAYS[p.wd]}, ${bnDigits(p.day)} ${MONTHS[p.m]}`;
}

export function timeLabel(iso: string | Date): string {
  const p = dhaka(iso);
  const period = p.h < 12 ? 'সকাল' : p.h < 16 ? 'দুপুর' : p.h < 18 ? 'বিকাল' : 'সন্ধ্যা';
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  return `${period} ${bnDigits(h12)}:${bnDigits(String(p.min).padStart(2, '0'))}`;
}

/** Bangla clock label for minutes after midnight (e.g. 600 -> "সকাল ১০:০০"); same wording as timeLabel. */
export function minuteLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const period = h < 12 ? 'সকাল' : h < 16 ? 'দুপুর' : h < 18 ? 'বিকাল' : 'সন্ধ্যা';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${period} ${bnDigits(h12)}:${bnDigits(String(minutes % 60).padStart(2, '0'))}`;
}

export const slotLabel = (start: string, end: string) => `${dayLabel(start)} · ${timeLabel(start)} – ${timeLabel(end)}`;

export const dhakaDayKey = (iso: string) => {
  const p = dhaka(iso);
  return `${p.y}-${p.m}-${p.day}`;
};

export const ORDER_STATUS_BN: Record<string, string> = {
  PENDING_PAYMENT: 'পেমেন্টের অপেক্ষায়',
  PLACED: 'অর্ডার গ্রহণ করা হয়েছে',
  CONFIRMED: 'নিশ্চিত করা হয়েছে',
  PREPARING: 'প্রস্তুত করা হচ্ছে',
  READY_FOR_DISPATCH: 'পাঠানোর জন্য প্রস্তুত',
  OUT_FOR_DELIVERY: 'ডেলিভারির পথে',
  DELIVERED: 'পৌঁছে দেওয়া হয়েছে',
  DELIVERY_FAILED: 'ডেলিভারি করা যায়নি',
  CANCELLED: 'বাতিল',
  REJECTED: 'গ্রহণ করা যায়নি',
  EXPIRED: 'পেমেন্টের সময় শেষ',
};

export const PAYMENT_STATUS_BN: Record<string, string> = {
  UNPAID: 'পরিশোধ বাকি',
  PENDING: 'যাচাই হচ্ছে',
  PAID: 'পরিশোধিত',
  FAILED: 'ব্যর্থ',
  CANCELLED: 'বাতিল',
  PARTIALLY_REFUNDED: 'আংশিক ফেরত',
  REFUNDED: 'ফেরত দেওয়া হয়েছে',
};
