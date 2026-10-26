import { toLatinDigits } from './money.js';

/**
 * Bangladeshi mobile numbers: 01[3-9] followed by 8 digits.
 * Normalised form is E.164: +8801XXXXXXXXX (14 characters).
 */
const LOCAL_MOBILE = /^01[3-9]\d{8}$/;

export class PhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneError';
  }
}

/** Returns the E.164 form, or null when the input is not a valid BD mobile number. */
export function tryNormalizeBdMobile(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[\s\-().]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('880')) digits = digits.slice(2); // keep the leading 0
  if (!/^\d+$/.test(digits)) return null;
  if (!LOCAL_MOBILE.test(digits)) return null;
  return `+88${digits}`;
}

export function normalizeBdMobile(input: string): string {
  const result = tryNormalizeBdMobile(input);
  if (result === null) throw new PhoneError('Invalid Bangladeshi mobile number');
  return result;
}

/** "+8801712345678" → "+88017******78". Used in logs and staff views. */
export function maskPhone(e164: string): string {
  if (e164.length < 8) return '***';
  return e164.slice(0, 6) + '*'.repeat(e164.length - 8) + e164.slice(-2);
}
