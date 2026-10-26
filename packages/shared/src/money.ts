/**
 * Money helpers. All amounts are integer poisha (1 BDT = 100 poisha).
 * This module is the only place monetary arithmetic happens (TRD §5.1).
 */

export type Poisha = number;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `value` is a safe integer (negative allowed for deltas). */
export function assertInt(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer, got ${String(value)}`);
  }
}

/** Throws unless `value` is a non-negative safe integer. */
export function assertPoisha(value: number, label = 'amount'): void {
  assertInt(value, label);
  if (value < 0) throw new MoneyError(`${label} must not be negative, got ${value}`);
}

export function sum(values: readonly Poisha[]): Poisha {
  let total = 0;
  for (const v of values) {
    assertInt(v);
    total += v;
  }
  assertInt(total, 'sum');
  return total;
}

export function multiply(unit: Poisha, quantity: number): Poisha {
  assertPoisha(unit, 'unit');
  assertPoisha(quantity, 'quantity');
  const result = unit * quantity;
  assertInt(result, 'product');
  return result;
}

/**
 * Percentage of an amount given in basis points (1% = 100 bp),
 * rounded half up to the poisha. Integer-only arithmetic.
 */
export function percentOfBp(amount: Poisha, basisPoints: number): Poisha {
  assertPoisha(amount);
  assertPoisha(basisPoints, 'basisPoints');
  if (basisPoints > 10_000) throw new MoneyError('basisPoints must be <= 10000');
  const scaled = amount * basisPoints;
  assertInt(scaled, 'scaled');
  return Math.floor((scaled + 5_000) / 10_000);
}

/** Parses a taka string such as "120", "120.5" or "1,250.75" into poisha without floats. */
export function parseTaka(input: string): Poisha {
  const cleaned = toLatinDigits(input).replace(/[,\s৳]/g, '');
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new MoneyError(`Invalid taka amount: "${input}"`);
  const whole = Number(match[1]);
  const frac = Number((match[2] ?? '').padEnd(2, '0'));
  return whole * 100 + frac;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export function toLatinDigits(input: string): string {
  return input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

/**
 * Formats poisha as taka, e.g. 125050 → "৳১,২৫০.৫০" (bn) or "৳1,250.50" (en).
 * Bangladeshi grouping (lakh/crore) via the bn-BD / en-IN locales.
 * Decimals are shown only when non-zero.
 */
export function formatTaka(amount: Poisha, locale: 'bn' | 'en' = 'bn'): string {
  assertInt(amount);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const nf = new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-IN', { useGrouping: true });
  let text = nf.format(whole);
  if (frac !== 0) {
    const fracText = String(frac).padStart(2, '0');
    text += '.' + (locale === 'bn' ? fracText.replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d) : fracText);
  }
  return `${negative ? '-' : ''}৳${text}`;
}

/**
 * Splits `total` across `weights` proportionally using the largest-remainder
 * method so the parts always sum exactly to `total`. Used to allocate an
 * order-level discount to order lines.
 */
export function allocateProportionally(total: Poisha, weights: readonly Poisha[]): Poisha[] {
  assertPoisha(total, 'total');
  weights.forEach((w) => assertPoisha(w, 'weight'));
  const weightSum = sum(weights);
  if (weights.length === 0) {
    if (total !== 0) throw new MoneyError('Cannot allocate a non-zero total to no weights');
    return [];
  }
  if (weightSum === 0) {
    if (total !== 0) throw new MoneyError('Cannot allocate a non-zero total to zero weights');
    return weights.map(() => 0);
  }
  const base = weights.map((w) => Math.floor((total * w) / weightSum));
  const remainders = weights.map((w, i) => ({ i, r: (total * w) % weightSum }));
  let left = total - sum(base);
  remainders.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of remainders) {
    if (left === 0) break;
    base[i] = (base[i] ?? 0) + 1;
    left -= 1;
  }
  return base;
}
