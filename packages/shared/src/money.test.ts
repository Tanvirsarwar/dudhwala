import { describe, expect, it } from 'vitest';
import { allocateProportionally, formatTaka, multiply, parseTaka, percentOfBp, sum, MoneyError } from './money.js';

describe('money', () => {
  it('sums and multiplies integers', () => {
    expect(sum([100, 250, 5])).toBe(355);
    expect(multiply(12050, 3)).toBe(36150);
  });

  it('rejects floats and negatives where not allowed', () => {
    expect(() => multiply(10.5, 2)).toThrow(MoneyError);
    expect(() => multiply(-1, 2)).toThrow(MoneyError);
    expect(() => sum([0.1, 0.2])).toThrow(MoneyError);
  });

  it('computes basis-point percentages with half-up rounding', () => {
    expect(percentOfBp(10000, 1000)).toBe(1000); // 10% of ৳100
    expect(percentOfBp(1005, 1000)).toBe(101); // 100.5 → 101
    expect(percentOfBp(1004, 1000)).toBe(100); // 100.4 → 100
    expect(percentOfBp(999, 1250)).toBe(125); // 124.875 → 125
    expect(percentOfBp(0, 5000)).toBe(0);
    expect(() => percentOfBp(100, 10001)).toThrow(MoneyError);
  });

  it('parses taka strings without float error', () => {
    expect(parseTaka('120')).toBe(12000);
    expect(parseTaka('120.5')).toBe(12050);
    expect(parseTaka('1,250.75')).toBe(125075);
    expect(parseTaka('৳ ১২০.৫০')).toBe(12050);
    expect(parseTaka('0.29')).toBe(29);
    expect(() => parseTaka('12.345')).toThrow(MoneyError);
    expect(() => parseTaka('-5')).toThrow(MoneyError);
    expect(() => parseTaka('abc')).toThrow(MoneyError);
  });

  it('formats taka in Bangla and English with lakh grouping', () => {
    expect(formatTaka(12000, 'bn')).toBe('৳১২০');
    expect(formatTaka(125050, 'bn')).toBe('৳১,২৫০.৫০');
    expect(formatTaka(12345600, 'en')).toBe('৳1,23,456');
    expect(formatTaka(5, 'en')).toBe('৳0.05');
    expect(formatTaka(-12000, 'en')).toBe('-৳120');
  });

  it('allocates proportionally and always sums to the total', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(1000, [3000, 1000])).toEqual([750, 250]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(0, [])).toEqual([]);
    expect(allocateProportionally(0, [0, 0])).toEqual([0, 0]);
    expect(() => allocateProportionally(5, [])).toThrow(MoneyError);
    expect(() => allocateProportionally(5, [0])).toThrow(MoneyError);
    for (let total = 0; total < 200; total += 7) {
      const parts = allocateProportionally(total, [333, 667, 1, 999]);
      expect(sum(parts)).toBe(total);
    }
  });
});
