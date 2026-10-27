/**
 * Lightweight client-side catalogue search: typo-tolerant, alias-aware, Bangla and English.
 * No dependencies. Alias groups are the configurable part (SEARCH_ALIASES): every term in a group is treated as
 * the same word, so "doi", "dohi", "dahi", "yogurt" and "দই" all find curd products.
 */

/** Alias groups: add a row to teach the search a new spelling, transliteration or synonym. */
export const SEARCH_ALIASES: readonly (readonly string[])[] = [
  ['milk', 'mlk', 'mik', 'dudh', 'dud', 'doodh', 'dugdho', 'দুধ'],
  ['curd', 'doi', 'dohi', 'dahi', 'yogurt', 'yoghurt', 'yogourt', 'দই', 'ইয়োগার্ট', 'মিষ্টি দই'],
  ['ghee', 'ghi', 'gee', 'ghii', 'ghea', 'ghe', 'ঘি', 'clarified'],
  ['butter', 'makhon', 'makhan', 'মাখন', 'bator'],
  ['paneer', 'panir', 'ponir', 'ponner', 'cheese', 'chij', 'chiz', 'পনির', 'চিজ'],
  ['sweet', 'sweets', 'mishti', 'misti', 'mithai', 'মিষ্টি'],
  ['bakery', 'bread', 'pauruti', 'paurooti', 'bun', 'cake', 'rusk', 'বেকারি', 'পাউরুটি', 'কেক'],
  ['chanachur', 'chachachur', 'chanachoor', 'chanchur', 'chanacur', 'snack', 'snacks', 'nimki', 'dalmoth', 'চানাচুর', 'স্ন্যাকস'],
  ['gur', 'gul', 'jaggery', 'jagery', 'joggery', 'jagary', 'molasses', 'গুড়', 'গুর', 'sweetener', 'sweeteners'],
  ['biscuit', 'biscuits', 'biscute', 'biskut', 'biscut', 'biscit', 'bisket', 'biskit', 'cookie', 'cookies', 'বিস্কুট', 'কুকিজ'],
  ['grocery', 'mudi', 'dal', 'lentil', 'rice', 'chal', 'oil', 'tel', 'মুদি', 'ডাল', 'চাল', 'তেল'],
];

export interface SearchEntry<T> {
  item: T;
  /** names, in the order they matter: product names first, then category names */
  primary: string[];
  secondary: string[];
}
export interface SearchIndex<T> {
  entries: { item: T; tokens: { t: string; w: number; key: string; both: boolean }[]; nameLen: number }[];
  vocab: string[];
}
export interface SearchHit<T> {
  item: T;
  score: number;
}

const BN = /[ঀ-৿]/;

/** Lower-case, strip Latin diacritics (never Bangla marks), split into words. */
export function tokenize(text: string): string[] {
  const t = BN.test(text) ? text.normalize('NFC') : text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return t
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/** Rough pronunciation key for Latin words: "biscute" and "biskut" share it; vowels and h are dropped. */
export function soundKey(word: string): string {
  if (BN.test(word)) return word;
  let s = word.toLowerCase().replace(/ph/g, 'f').replace(/ch/g, 'C').replace(/sh/g, 'S').replace(/[qc]/g, 'k').replace(/z/g, 'j').replace(/w/g, 'v').replace(/h/g, '');
  s = s.charAt(0) + s.slice(1).replace(/[aeiouy]/g, '');
  return s.replace(/(.)\1+/g, '$1');
}

/** Damerau-Levenshtein (adjacent swaps count as one edit); gives up once the distance exceeds `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, (prev2[j - 2] ?? 0) + 1);
      cur[j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

const GROUP_OF = new Map<string, readonly string[]>();
for (const g of SEARCH_ALIASES) for (const term of g) for (const tok of tokenize(term)) GROUP_OF.set(tok, g);

/** Builds the index once per catalogue. `weights`: product names 1, category names 0.85, alias terms 0.9. */
export function buildSearchIndex<T>(entries: SearchEntry<T>[]): SearchIndex<T> {
  const vocab = new Set<string>();
  const out = entries.map((e) => {
    const tokens = new Map<string, { t: string; w: number; key: string; both: boolean }>();
    const add = (t: string, w: number, mark = true) => {
      const old = tokens.get(t);
      if (!old) tokens.set(t, { t, w, key: soundKey(t), both: false });
      else {
        if (mark && old.w !== w) old.both = true; // same word in the product name and its category: a stronger match
        old.w = Math.max(old.w, w);
      }
    };
    const base: string[] = [];
    for (const n of e.primary)
      for (const t of tokenize(n)) {
        add(t, 1);
        base.push(t);
        vocab.add(t);
      }
    for (const n of e.secondary)
      for (const t of tokenize(n)) {
        add(t, 0.85);
        base.push(t);
        vocab.add(t);
      }
    for (const t of base) {
      const g = GROUP_OF.get(t);
      if (g) for (const term of g) for (const tt of tokenize(term)) add(tt, 0.9, false);
    }
    return { item: e.item, tokens: [...tokens.values()], nameLen: e.primary.join(' ').length };
  });
  return { entries: out, vocab: [...vocab] };
}

/** Score 0..100 of one query word against one indexed word. */
function wordScore(q: string, qKey: string, d: { t: string; key: string; both: boolean }): number {
  const t = d.t;
  if (t === q) return d.both ? 104 : 100;
  if (q.length >= 2 && t.startsWith(q)) return 92 - Math.min(10, t.length - q.length);
  if (q.length >= 3 && t.includes(q)) return 76;
  if (q.length >= 3 && qKey.length >= 3 && qKey === d.key) return 82;
  const allowed = q.length <= 3 ? 0 : q.length <= 5 ? 1 : 2;
  if (allowed > 0) {
    const dist = editDistance(q, t, allowed);
    if (dist <= allowed) return 74 - dist * 12;
  }
  return 0;
}

/** Ranked hits: exact word matches first, then prefix, sound-alike and typo matches. All query words must match. */
export function searchIndex<T>(index: SearchIndex<T>, query: string, limit = 50): SearchHit<T>[] {
  const words = tokenize(query);
  if (words.length === 0) return [];
  const keys = words.map(soundKey);
  const hits: (SearchHit<T> & { len: number })[] = [];
  for (const e of index.entries) {
    let total = 0;
    let all = true;
    for (let i = 0; i < words.length; i++) {
      let best = 0;
      for (const d of e.tokens) best = Math.max(best, wordScore(words[i] ?? '', keys[i] ?? '', d) * d.w);
      if (best < 45) {
        all = false;
        break;
      }
      total += best;
    }
    if (all) hits.push({ item: e.item, score: total / words.length, len: e.nameLen });
  }
  hits.sort((a, b) => b.score - a.score || a.len - b.len);
  return hits.slice(0, limit).map(({ item, score }) => ({ item, score }));
}

/** "Did you mean" words for a query that found nothing: the closest vocabulary words, best first. */
export function suggestCorrections<T>(index: SearchIndex<T>, query: string, max = 3): string[] {
  const out = new Map<string, number>();
  for (const w of tokenize(query)) {
    for (const v of index.vocab) {
      if (BN.test(v) || v.length < 3 || /\d/.test(v)) continue;
      const d = Math.min(editDistance(w, v, 3), soundKey(w) === soundKey(v) ? 1 : 9);
      if (d <= Math.max(2, Math.floor(w.length / 3))) out.set(v, Math.min(out.get(v) ?? 9, d));
    }
  }
  return [...out.entries()].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).slice(0, max).map(([w]) => w);
}
