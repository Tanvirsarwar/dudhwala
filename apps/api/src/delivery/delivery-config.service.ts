import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { newId } from '../common/crypto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { addDays, dhakaDate, dhakaInstant, dhakaWeekday } from './slots.js';

export const SLOT_GENERATION_JOB = 'delivery.generate_slots';

/**
 * Turns slot templates into dated slot instances for the booking horizon.
 * Idempotent: (outlet_id, starts_at) is unique and existing slots — with their
 * bookings and any manual capacity edits — are never touched.
 */
@Injectable()
export class SlotGenerator implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(SLOT_GENERATION_JOB, async () => {
      await this.generate();
      const pending = await this.prisma.job.count({ where: { type: SLOT_GENERATION_JOB, status: 'PENDING' } });
      if (pending === 0) await this.jobs.enqueue(SLOT_GENERATION_JOB, {}, { runAt: new Date(this.clock.now().getTime() + 3_600_000) });
    });
  }

  async generate(outletId?: string): Promise<number> {
    const horizon = await this.settings.get('delivery.bookingHorizonDays');
    const today = dhakaDate(this.clock.now());
    const templates = await this.prisma.deliverySlotTemplate.findMany({
      where: { active: true, ...(outletId ? { outletId } : {}), outlet: { status: { not: 'CLOSED' } } },
      include: { outlet: { include: { closures: true, hours: true } } },
    });
    let created = 0;
    for (let d = 0; d <= horizon; d++) {
      const date = addDays(today, d);
      const weekday = dhakaWeekday(date);
      for (const t of templates) {
        if (t.weekday !== weekday) continue;
        if (t.outlet.closures.some((c) => c.date.toISOString().slice(0, 10) === date)) continue;
        // Operating hours (if any are configured) bound the slot window; days without hours are closed.
        if (t.outlet.hours.length > 0 && !withinHours(t.outlet.hours, weekday, t.startsAt, t.endsAt)) continue;
        const startsAt = dhakaInstant(date, t.startsAt);
        const endsAt = dhakaInstant(date, t.endsAt);
        const cutoffAt = new Date(startsAt.getTime() - t.cutoffMinutes * 60_000);
        if (endsAt <= this.clock.now()) continue;
        const rows = await this.prisma.$executeRaw`
          INSERT INTO delivery_slot (id, outlet_id, template_id, slot_date, starts_at, ends_at, cutoff_at, capacity, booked_count, status)
          VALUES (${newId()}::uuid, ${t.outletId}::uuid, ${t.id}::uuid, ${date}::date, ${startsAt}, ${endsAt}, ${cutoffAt}, ${t.capacity}, 0, 'OPEN')
          ON CONFLICT (outlet_id, starts_at) DO NOTHING`;
        created += rows;
      }
    }
    return created;
  }
}

/** True when [start, end] lies inside one opening span for the weekday (TIME columns compared as HH:MM). */
export function withinHours(hours: { weekday: number; opensAt: Date; closesAt: Date }[], weekday: number, start: Date, end: Date): boolean {
  const t = (d: Date) => d.toISOString().slice(11, 16);
  return hours.some((h) => h.weekday === weekday && t(h.opensAt) <= t(start) && t(end) <= t(h.closesAt));
}
