import { describe, expect, it } from 'vitest';
import { buildSearchIndex, editDistance, searchIndex, soundKey, suggestCorrections, tokenize } from './search.js';

interface P {
  id: string;
  bn: string;
  en: string;
  catBn: string;
  catEn: string;
}
const P: P[] = [
  { id: 'milk', bn: 'খাঁটি তরল দুধ', en: 'Fresh Milk', catBn: 'দুধ', catEn: 'Milk' },
  { id: 'mbread', bn: 'মিল্ক ব্রেড', en: 'Milk Bread', catBn: 'বেকারি', catEn: 'Bakery' },
  { id: 'curd', bn: 'মিষ্টি দই', en: 'Sweet Curd (Mishti Doi)', catBn: 'দই', catEn: 'Curd' },
  { id: 'ghee', bn: 'খাঁটি ঘি', en: 'Pure Ghee', catBn: 'ঘি ও মাখন', catEn: 'Ghee & Butter' },
  { id: 'bisk', bn: 'মিল্ক বিস্কুট', en: 'Milk Biscuit', catBn: 'বিস্কুট ও কুকিজ', catEn: 'Biscuits & Cookies' },
  { id: 'cookie', bn: 'বাটার কুকিজ', en: 'Butter Cookies', catBn: 'বিস্কুট ও কুকিজ', catEn: 'Biscuits & Cookies' },
  { id: 'chan', bn: 'চানাচুর', en: 'Chanachur', catBn: 'চানাচুর ও স্ন্যাকস', catEn: 'Chanachur & Snacks' },
  { id: 'gur', bn: 'খেজুর গুড়', en: 'Khejur Gur', catBn: 'গুড় ও মিষ্টিকারক', catEn: 'Gur & Sweeteners' },
  { id: 'jag', bn: 'আখের গুড়', en: 'Cane Jaggery', catBn: 'গুড় ও মিষ্টিকারক', catEn: 'Gur & Sweeteners' },
  { id: 'sand', bn: 'সন্দেশ', en: 'Sandesh', catBn: 'মিষ্টি', catEn: 'Sweets' },
];
const idx = buildSearchIndex(P.map((p) => ({ item: p, primary: [p.bn, p.en], secondary: [p.catBn, p.catEn] })));
const ids = (q: string) => searchIndex(idx, q).map((h) => h.item.id);

describe('search helpers', () => {
  it('tokenizes Latin (strips accents) and Bangla (keeps marks)', () => {
    expect(tokenize('Crème-Brûlée, 5kg')).toEqual(['creme', 'brulee', '5kg']);
    expect(tokenize('খাঁটি  ঘি')).toEqual(['খাঁটি', 'ঘি']);
  });
  it('soundKey ignores vowels, h and doubled letters', () => {
    expect(soundKey('biscute')).toBe(soundKey('biskut'));
    expect(soundKey('milk')).toBe(soundKey('mlk'));
    expect(soundKey('দই')).toBe('দই');
  });
  it('editDistance counts swaps once and stops early', () => {
    expect(editDistance('milk', 'milk')).toBe(0);
    expect(editDistance('milk', 'mlik')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('a', 'abcdefgh')).toBe(4);
    expect(editDistance('abcdef', 'uvwxyz')).toBe(4);
  });
});

describe('searchIndex: the required typos and transliterations', () => {
  it.each([
    ['mlk', 'milk'],
    ['milk', 'milk'],
    ['dudh', 'milk'],
    ['ghi', 'ghee'],
    ['gee', 'ghee'],
    ['ghee', 'ghee'],
    ['doi', 'curd'],
    ['dohi', 'curd'],
    ['curd', 'curd'],
    ['biscute', 'bisk'],
    ['biskut', 'bisk'],
    ['chachachur', 'chan'],
    ['chanachur', 'chan'],
    ['gur', 'gur'],
    ['jaggery', 'jag'],
    ['দই', 'curd'],
    ['ঘি', 'ghee'],
    ['গুড়', 'gur'],
  ])('%s finds %s', (q, id) => {
    expect(ids(q)).toContain(id);
  });

  it('puts exact name matches above fuzzy ones', () => {
    expect(ids('milk')[0]).toBe('milk'); // shortest exact product name first
    expect((searchIndex(idx, 'ghee')[0]?.score ?? 0)).toBeGreaterThan((searchIndex(idx, 'ghea')[0]?.score ?? 0) - 1);
    const exact = searchIndex(idx, 'sandesh')[0];
    const typo = searchIndex(idx, 'sandsh')[0];
    expect(exact?.item.id).toBe('sand');
    expect(typo?.item.id).toBe('sand');
    expect(exact?.score ?? 0).toBeGreaterThan(typo?.score ?? 0);
  });

  it('requires every word, supports prefixes, and ignores empty queries', () => {
    expect(ids('sweet curd')).toEqual(['curd']);
    expect(ids('milk bisc')).toEqual(['bisk']);
    expect(ids('chan')).toContain('chan');
    expect(ids('   ')).toEqual([]);
    expect(ids('zzzzqq')).toEqual([]);
  });

  it('matches category names and respects the limit', () => {
    expect(ids('snacks')).toContain('chan');
    expect(searchIndex(idx, 'milk', 2)).toHaveLength(2);
  });
});

describe('suggestCorrections', () => {
  it('offers close words for a query with no results', () => {
    expect(suggestCorrections(idx, 'mliky')).toContain('milk');
    expect(suggestCorrections(idx, 'sandsh')).toContain('sandesh');
    expect(suggestCorrections(idx, 'zzzzqq')).toEqual([]);
  });
});
