import { describe, expect, it } from 'vitest';
import { toEnglish } from './i18n-en.js';

describe('toEnglish: demo ordering strings', () => {
  it('converts clock times and dates produced by the storefront formatters', () => {
    expect(toEnglish('সকাল ১০:০০')).toBe('10:00 AM');
    expect(toEnglish('সন্ধ্যা ১০:০০')).toBe('10:00 PM');
    expect(toEnglish('দুপুর ১২:৩০')).toBe('12:30 PM');
    expect(toEnglish('সন্ধ্যা ১০:০০ পর্যন্ত')).toBe('until 10:00 PM');
    expect(toEnglish('সোমবার, ১০ মার্চ')).toBe('Mon, 10 Mar');
  });
  it('translates the key zone, fulfilment and payment labels', () => {
    expect(toEnglish('ইন সিলেট')).toBe('In Sylhet');
    expect(toEnglish('আউটার সিলেট')).toBe('Outer Sylhet');
    expect(toEnglish('এক্সপ্রেস পিকআপ')).toBe('Express Pickup');
    expect(toEnglish('ডেমো/সিমুলেটেড পেমেন্ট')).toBe('Demo/Simulated Payment');
    expect(toEnglish('দাম শীঘ্রই জানানো হবে')).toBe('Price to be announced');
  });
  it('translates aria-style patterns whose product name contains digits', () => {
    expect(toEnglish('ঘোল ২৫০ গ্রাম — কার্টে যোগ করুন')).toBe('Ghol 250 g — Add to cart');
    expect(toEnglish('সাদা রসগোল্লা সংখ্যা')).toBe('White Rasgulla quantity');
    expect(toEnglish('সর্বোচ্চ ২০টি নেওয়া যাবে')).toBe('Maximum 20 allowed');
  });
});
