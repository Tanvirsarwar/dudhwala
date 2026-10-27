import { EN_DICT } from './i18n-dict.js';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const UNITS: [RegExp, string][] = [
  [/(\d+(?:\.\d+)?)\s*মিলি/g, '$1 ml'],
  [/(\d+(?:\.\d+)?)\s*লিটার/g, '$1 L'],
  [/(\d+(?:\.\d+)?)\s*কেজি/g, '$1 kg'],
  [/(\d+(?:\.\d+)?)\s*গ্রাম/g, '$1 g'],
  [/(\d+(?:\.\d+)?)\s*পিস/g, '$1 pcs'],
];
const PATTERNS: [RegExp, string][] = [
  [/^ছবি (\d+)$/, 'Photo $1'],
  [/^(.+) — কার্টে যোগ করুন$/, '$1 — Add to cart'],
  [/^(.+) — অপশন দেখুন$/, '$1 — View options'],
  [/^(.+) কার্টে যোগ হয়েছে$/, '$1 added to cart'],
  [/^(.+) — ছবি শীঘ্রই আসছে$/, '$1 — photo coming soon'],
  [/^সর্বোচ্চ (\d+)টি নেওয়া যাবে$/, 'Maximum $1 allowed'],
];

const latinDigits = (s: string) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
const HAS_BN = /[ঀ-৿]/;

/** English text for a rendered Bangla fragment, or null when nothing applies (leave the text as is). */
export function toEnglish(text: string): string | null {
  if (!HAS_BN.test(text)) return null;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  const [lead, core, trail] = [m?.[1] ?? '', m?.[2] ?? text, m?.[3] ?? ''];
  const direct = EN_DICT[core];
  if (direct !== undefined) return lead + direct + trail;
  if (/[।.]$/.test(core)) {
    const bare = EN_DICT[core.replace(/[।.]$/, '')];
    if (bare !== undefined) return lead + bare + (/[.!?]$/.test(bare) ? '' : '.') + trail; // sentence ends in a danda in the source
  }
  let s = latinDigits(core);
  const cart = /^কার্ট, (\d+)টি পণ্য$/.exec(s);
  if (cart) return `${lead}Cart, ${cart[1]} item${cart[1] === '1' ? '' : 's'}${trail}`;
  for (const [re, to] of PATTERNS) {
    if (re.test(s)) return lead + s.replace(re, (...a) => to.replace(/\$(\d)/g, (_, i) => String(toEnglish(String(a[Number(i)])) ?? a[Number(i)]))) + trail;
  }
  for (const [re, to] of UNITS) s = s.replace(re, to);
  // Only digits and units are converted outside the dictionary; a half-translated sentence is worse than Bangla.
  return s === core ? null : lead + s + trail;
}
