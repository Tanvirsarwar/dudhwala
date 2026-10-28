// Seed catalogue + eligibility checks for the demo data. Run: node --test demo/mock-api/   (needs `pnpm --filter @dudhwala/shared build`)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedState } from './data.mjs';
import { zoneEligibility, EN_DICT } from '../../packages/shared/dist/index.js';

const { categories, products } = seedState();
const cat = JSON.parse(readFileSync(new URL('./catalogue.json', import.meta.url), 'utf8'));
const OLD_SAMPLE = ['খাঁটি তরল দুধ', 'ফুল ক্রিম দুধ', 'চকলেট ফ্লেভার্ড মিল্ক', 'মিষ্টি দই', 'বোরহানি', 'খাঁটি ঘি', 'সল্টেড বাটার', 'রসগোল্লা', 'চমচম', 'সন্দেশ', 'তাজা পনির', 'মোজারেলা চিজ', 'মিল্ক ব্রেড', 'ক্রিম বান', 'চানাচুর', 'খেজুর গুড়', 'বাসমতি চাল', 'সরিষার তেল', 'মসুর ডাল'];
const elig = (zone) => products.filter((p) => zoneEligibility({ categorySlug: p.categorySlug, outerCityStatus: p.outerCityStatus }, zone).eligible);
const ids = (list) => new Set(list.map((p) => p.slug));

test('catalogue: counts per category and total', () => {
  assert.equal(cat.products.length, 59);
  assert.equal(products.length, 59);
  for (const [slug, n] of [['dairy-sweets', 23], ['doi-dairy', 11], ['bakery', 25]]) assert.equal(products.filter((p) => p.categorySlug === slug).length, n, slug);
  assert.deepEqual(categories.map((c) => c.slug).sort(), ['bakery', 'dairy-sweets', 'doi-dairy']);
});

test('catalogue: no temporary/sample products and no invented data', () => {
  const OLD_SLUGS = ['fresh-milk', 'full-cream-milk', 'sweet-curd', 'pure-ghee', 'rosh-malai', 'rasgulla', 'paneer', 'milk-bread'];
  for (const s of OLD_SLUGS) assert.ok(!products.some((p) => p.slug === s), `sample slug still present: ${s}`);
  const names = new Set(products.map((p) => p.nameBn));
  for (const old of OLD_SAMPLE) assert.ok(!names.has(old), `sample product still present: ${old}`);
  for (const p of products) {
    assert.equal(p.variants.length, 1, p.slug);
    assert.equal(p.variants[0].pricePoisha, null, `${p.slug}: price must stay empty until supplied`);
    assert.equal(p.variants[0].stock, null, `${p.slug}: stock must stay empty until supplied`);
    assert.equal(p.content.descriptionBn, null);
  }
});

test('catalogue: no duplicate ids, slugs or names', () => {
  for (const key of ['slug', 'nameBn', 'nameEn', 'id']) assert.equal(new Set(products.map((p) => p[key])).size, products.length, key);
  assert.equal(new Set(products.flatMap((p) => p.variants.map((v) => v.id))).size, products.length);
});

test('catalogue: every product and category name has an English translation', () => {
  for (const p of products) assert.ok(EN_DICT[p.nameBn], `missing EN for ${p.nameBn}`);
  for (const c of categories) assert.ok(EN_DICT[c.nameBn], `missing EN for ${c.nameBn}`);
});

test('eligibility: In City accepts every product', () => {
  assert.equal(elig('IN_CITY').length, 59);
});

test('eligibility: Outer City = verified Bakery + ticked Dairy Sweets + the four confirmed Doi items', () => {
  const out = elig('OUTER_CITY');
  assert.equal(out.length, 25);
  assert.deepEqual([...ids(out.filter((p) => p.categorySlug === 'dairy-sweets'))].sort(), ['ds-24', 'ds-25']);
  assert.equal(out.filter((p) => p.categorySlug === 'bakery').length, 19);
  assert.deepEqual([...ids(out.filter((p) => p.categorySlug === 'doi-dairy'))].sort(), ['doi-03', 'doi-04', 'doi-06', 'doi-07'], 'bati doi, premium doi, premium cup doi, cup doi');
});

test('eligibility: uncertain mappings are not enabled for Outer City', () => {
  const out = ids(elig('OUTER_CITY'));
  for (const id of ['ds-04', 'doi-01', 'doi-02', 'doi-05', 'doi-08', 'doi-11', 'bk-vanilla-biscuit', 'bk-salt-biscuit', 'bk-dry-cake', 'bk-sweet-cake', 'bk-bos-cake', 'bk-honey-toast']) assert.ok(!out.has(id), id);
  const unverified = cat.products.filter((p) => !p.nameVerified).map((p) => p.id);
  assert.equal(unverified.length, 11);
  // unverified bakery names are excluded; unverified dairy-sweet names are excluded because they are not ticked
  for (const id of unverified) assert.ok(!out.has(id), `unverified product enabled for Outer City: ${id}`);
});
