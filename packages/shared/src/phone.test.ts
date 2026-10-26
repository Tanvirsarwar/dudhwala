import { describe, expect, it } from 'vitest';
import { maskPhone, normalizeBdMobile, PhoneError, tryNormalizeBdMobile } from './phone.js';

describe('phone', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['008801712345678', '+8801712345678'],
    ['017-1234 5678', '+8801712345678'],
    ['০১৭১২৩৪৫৬৭৮', '+8801712345678'],
    ['01312345678', '+8801312345678'],
    ['01912345678', '+8801912345678'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeBdMobile(input)).toBe(expected);
  });

  it.each(['01212345678', '0171234567', '017123456789', '+441712345678', '01712abc678', ''])('rejects %s', (input) => {
    expect(tryNormalizeBdMobile(input)).toBeNull();
    expect(() => normalizeBdMobile(input)).toThrow(PhoneError);
  });

  it('masks phone numbers', () => {
    expect(maskPhone('+8801712345678')).toBe('+88017******78');
    expect(maskPhone('123')).toBe('***');
  });
});
