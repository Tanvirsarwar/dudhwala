import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, type StaffPrincipal } from '../access/principal.js';
import { dhakaInstant, timeOfDay } from '../delivery/slots.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM (24-hour)');
const HoursIn = z
  .object({
    hours: z
      .array(z.object({ weekday: z.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmm }).strict().refine((h) => h.closesAt > h.opensAt, 'closing time must be after opening time'))
      .max(21),
  })
  .strict();
const ClosureIn = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(2).max(200) }).strict();

const toHHMM = (d: Date) => d.toISOString().slice(11, 16);

/**
 * Operating hours and closure days (OPEN_DECISIONS C2). Hours bound which
 * slot windows are generated; a closure day closes that day's empty slots.
 * Slots that already hold orders are left open and reported so the manager
 * reschedules or contacts those customers — nothing is cancelled silently.
 */
@Controller('admin/outlets/:outletId')
export class OutletHoursController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('hours')
  @RequirePermission('outlets.read')
  async hours(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    const [rows, closures] = await Promise.all([
      this.prisma.outletHours.findMany({ where: { outletId }, orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }] }),
      this.prisma.outletClosure.findMany({ where: { outletId }, orderBy: { date: 'asc' } }),
    ]);
    return {
      hours: rows.map((r) => ({ weekday: r.weekday, opensAt: toHHMM(r.opensAt), closesAt: toHHMM(r.closesAt) })),
      closures: closures.map((c) => ({ date: c.date.toISOString().slice(0, 10), reason: c.reason })),
    };
  }

  /** Replaces the weekly schedule. An empty list removes all hours (no restriction on slots). */
  @Put('hours')
  @RequirePermission('outlets.hours_manage')
  async setHours(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const { hours } = parse(HoursIn, body);
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      const spans = hours.filter((h) => h.weekday === day).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
      for (let i = 1; i < spans.length; i++) {
        if ((spans[i] as { opensAt: string }).opensAt < (spans[i - 1] as { closesAt: string }).closesAt) throw new AppError('VALIDATION_FAILED', `Overlapping hours on weekday ${day}`);
      }
    }
    if (!(await this.prisma.outlet.findUnique({ where: { id: outletId } }))) throw notFound('Outlet');
    await this.prisma.$transaction(async (tx) => {
      await tx.outletHours.deleteMany({ where: { outletId } });
      if (hours.length) await tx.outletHours.createMany({ data: hours.map((h) => ({ outletId, weekday: h.weekday, opensAt: timeOfDay(h.opensAt), closesAt: timeOfDay(h.closesAt) })) });
      await this.audit.record({ action: 'outlet.hours_update', entityType: 'outlet', entityId: outletId, outletId, after: { hours } }, { principal: p }, req, tx);
    });
    return this.hours(p, outletId);
  }

  @Post('closures')
  @RequirePermission('outlets.hours_manage')
  async addClosure(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(ClosureIn, body);
    if (!(await this.prisma.outlet.findUnique({ where: { id: outletId } }))) throw notFound('Outlet');
    const date = new Date(`${b.date}T00:00:00Z`);
    return this.prisma.$transaction(async (tx) => {
      await tx.outletClosure.upsert({ where: { outletId_date: { outletId, date } }, update: { reason: b.reason }, create: { outletId, date, reason: b.reason } });
      const from = dhakaInstant(b.date, '00:00');
      const to = new Date(from.getTime() + 86_400_000);
      const closed = await tx.deliverySlot.updateMany({ where: { outletId, startsAt: { gte: from, lt: to }, bookedCount: 0, status: 'OPEN' }, data: { status: 'CLOSED' } });
      const booked = await tx.deliverySlot.findMany({ where: { outletId, startsAt: { gte: from, lt: to }, bookedCount: { gt: 0 } }, select: { id: true, startsAt: true, bookedCount: true } });
      // Stop new bookings in slots that already have orders; existing orders stay for the manager to handle.
      if (booked.length) await tx.deliverySlot.updateMany({ where: { id: { in: booked.map((s) => s.id) } }, data: { status: 'CLOSED' } });
      await this.audit.record({ action: 'outlet.closure_add', entityType: 'outlet', entityId: outletId, outletId, after: b }, { principal: p }, req, tx);
      return { date: b.date, closedEmptySlots: closed.count, slotsWithOrders: booked.map((s) => ({ slotId: s.id, startsAt: s.startsAt, orders: s.bookedCount })) };
    });
  }

  @Delete('closures/:date')
  @RequirePermission('outlets.hours_manage')
  @HttpCode(204)
  async removeClosure(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Param('date') dateStr: string, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) throw new AppError('VALIDATION_FAILED', 'date must be YYYY-MM-DD');
    const r = await this.prisma.outletClosure.deleteMany({ where: { outletId, date: new Date(`${dateStr}T00:00:00Z`) } });
    if (r.count === 0) throw notFound('Closure');
    await this.audit.record({ action: 'outlet.closure_remove', entityType: 'outlet', entityId: outletId, outletId, after: { date: dateStr } }, { principal: p }, req);
  }
}
