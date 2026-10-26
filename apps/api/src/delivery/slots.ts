/**
 * Slot time maths in Asia/Dhaka. Bangladesh has used a fixed UTC+06:00 offset
 * with no daylight saving since 2009, so a constant offset is exact.
 */
export const DHAKA_OFFSET_MS = 6 * 3_600_000;

/** Calendar date (YYYY-MM-DD) in Dhaka for an instant. */
export function dhakaDate(d: Date): string {
  return new Date(d.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, in Dhaka. */
export function dhakaWeekday(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Instant for a Dhaka wall-clock time ("HH:MM" or Date from a TIME column) on a Dhaka date. */
export function dhakaInstant(dateStr: string, time: string | Date): Date {
  const hhmm = typeof time === 'string' ? time : time.toISOString().slice(11, 16);
  return new Date(new Date(`${dateStr}T${hhmm}:00Z`).getTime() - DHAKA_OFFSET_MS);
}

export function addDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** TIME columns arrive as 1970-01-01T<time>Z; build one from "HH:MM". */
export const timeOfDay = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00Z`);
