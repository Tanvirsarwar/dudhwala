import { Inject, Injectable } from '@nestjs/common';
import { hhmmToMinutes, zonedParts } from '@dudhwala/shared';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

type OutletWithHours = Prisma.OutletGetPayload<{ include: { hours: true } }>;

const timeToMinutes = (d: Date): number => d.getUTCHours() * 60 + d.getUTCMinutes();
export const hhmmToTime = (v: string): Date => new Date(`1970-01-01T${v.padStart(5, '0')}:00.000Z`);
const timeToHHMM = (d: Date): string => d.toISOString().slice(11, 16);
/** 0 = Sunday … 6 = Saturday for the Dhaka calendar day of `at`. */
export const dhakaWeekday = (at: Date): number => {
  const p = zonedParts(at);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
};

@Injectable()
export class OutletsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  view(o: OutletWithHours) {
    return {
      id: o.id,
      code: o.code,
      nameBn: o.nameBn,
      nameEn: o.nameEn,
      addressLine: o.addressLine,
      phone: o.phone,
      status: o.status,
      hours: [...o.hours].sort((a, b) => a.weekday - b.weekday).map((h) => ({ weekday: h.weekday, opens: timeToHHMM(h.opensAt), closes: timeToHHMM(h.closesAt) })),
    };
  }

  /**
   * Is the outlet open at `at`? Uses the outlet's own weekly hours when it has any;
   * an outlet with no hours entered yet falls back to the ordering hours (documented placeholder).
   */
  openAt(o: OutletWithHours, at: Date, fallback: { openMinute: number; closeMinute: number }): boolean {
    const minutes = zonedParts(at).minutes;
    if (o.hours.length === 0) return minutes >= fallback.openMinute && minutes <= fallback.closeMinute;
    const row = o.hours.find((h) => h.weekday === dhakaWeekday(at));
    return Boolean(row) && minutes >= timeToMinutes((row as { opensAt: Date }).opensAt) && minutes <= timeToMinutes((row as { closesAt: Date }).closesAt);
  }

  async replaceHours(tx: Tx, outletId: string, hours: { weekday: number; opens: string; closes: string }[]): Promise<void> {
    await tx.outletHours.deleteMany({ where: { outletId } });
    for (const h of hours) {
      const o = hhmmToMinutes(h.opens);
      const c = hhmmToMinutes(h.closes);
      if (o === null || c === null || o >= c) throw new Error('invalid hours');
    }
    await tx.outletHours.createMany({ data: hours.map((h) => ({ outletId, weekday: h.weekday, opensAt: hhmmToTime(h.opens), closesAt: hhmmToTime(h.closes) })) });
  }
}
