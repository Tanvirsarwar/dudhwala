import { EN_DICT } from './i18n-dict.js';

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const UNITS: [RegExp, string][] = [
  [/(\d+(?:\.\d+)?)\s*মিলি/g, '$1 ml'],
  [/(\d+(?:\.\d+)?)\s*লিটার/g, '$1 L'],
  [/(\d+(?:\.\d+)?)\s*কেজি/g, '$1 kg'],
  [/(\d+(?:\.\d+)?)\s*গ্রাম/g, '$1 g'],
  [/(\d+(?:\.\d+)?)\s*পিস/g, '$1 pcs'],
];
const N = '([\\d০-৯]+)'; // Bangla or Latin digits; captures are translated separately, so product names with numbers still match the dictionary
const PATTERNS: [RegExp, string][] = [
  [new RegExp(`^ছবি ${N}$`), 'Photo $1'],
  [/^(.+) — কার্টে যোগ করুন$/, '$1 — Add to cart'],
  [/^(.+) — অপশন দেখুন$/, '$1 — View options'],
  [/^(.+) কার্টে যোগ হয়েছে$/, '$1 added to cart'],
  [/^(.+) — ছবি শীঘ্রই আসছে$/, '$1 — photo coming soon'],
  [/^(.+) সংখ্যা$/, '$1 quantity'],
  [new RegExp(`^সর্বোচ্চ ${N}টি নেওয়া যাবে$`), 'Maximum $1 allowed'],
];

const DAYS_EN: Record<string, string> = { রবিবার: 'Sun', সোমবার: 'Mon', মঙ্গলবার: 'Tue', বুধবার: 'Wed', বৃহস্পতিবার: 'Thu', শুক্রবার: 'Fri', শনিবার: 'Sat' };
const MONTHS_EN: Record<string, string> = { জানুয়ারি: 'Jan', ফেব্রুয়ারি: 'Feb', মার্চ: 'Mar', এপ্রিল: 'Apr', মে: 'May', জুন: 'Jun', জুলাই: 'Jul', আগস্ট: 'Aug', সেপ্টেম্বর: 'Sep', অক্টোবর: 'Oct', নভেম্বর: 'Nov', ডিসেম্বর: 'Dec' };
// Times/dates rendered by apps/web/lib/format.ts (timeLabel/dayLabel): "সন্ধ্যা ১০:০০" -> "10:00 PM", "সোমবার, ১০ মার্চ" -> "Mon, 10 Mar".
const TIME_RE = /^(সকাল|দুপুর|বিকাল|সন্ধ্যা|রাত) (\d{1,2}):(\d{2})( পর্যন্ত)?$/;
const DAY_RE = /^(রবিবার|সোমবার|মঙ্গলবার|বুধবার|বৃহস্পতিবার|শুক্রবার|শনিবার), (\d{1,2}) (\S+)$/;
function dateTime(s: string): string | null {
  const both = /^(.+) · (.+)$/.exec(s);
  if (both) {
    const [a, b] = [dateTime(both[1] ?? ''), dateTime(both[2] ?? '')];
    return a && b ? `${a} · ${b}` : null;
  }
  const t = TIME_RE.exec(s);
  if (t) return `${t[4] ? 'until ' : ''}${Number(t[2])}:${t[3]} ${t[1] === 'সকাল' ? 'AM' : 'PM'}`;
  const d = DAY_RE.exec(s);
  if (d && MONTHS_EN[d[3] ?? ''] && DAYS_EN[d[1] ?? '']) return `${DAYS_EN[d[1] ?? '']}, ${d[2]} ${MONTHS_EN[d[3] ?? '']}`;
  return null;
}

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
  const dt = dateTime(s);
  if (dt) return lead + dt + trail;
  const cart = /^কার্ট, (\d+)টি পণ্য$/.exec(s);
  if (cart) return `${lead}Cart, ${cart[1]} item${cart[1] === '1' ? '' : 's'}${trail}`;
  for (const [re, to] of PATTERNS) {
    if (re.test(core)) return lead + core.replace(re, (...a) => to.replace(/\$(\d)/g, (_, i) => String(toEnglish(String(a[Number(i)])) ?? a[Number(i)]))) + trail;
  }
  for (const [re, to] of UNITS) s = s.replace(re, to);
  // Only digits and units are converted outside the dictionary; a half-translated sentence is worse than Bangla.
  return s === core ? null : lead + s + trail;
}
