import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, type StaffPrincipal } from '../access/principal.js';
import { SlotGenerator } from './delivery-config.service.js';
import { timeOfDay } from './slots.js';

const money = z.number().int().min(0).max(100_000_000);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const AreaIn = z.object({ slug: z.string().regex(/^[a-z0-9-]{2,80}$/), nameBn: z.string().trim().min(1).max(80), nameEn: z.string().trim().max(80).nullable().optional(), active: z.boolean().optional() }).strict();
const ZoneIn = z.object({ name: z.string().trim().min(1).max(80), areaIds: z.array(z.string().uuid()).max(500), active: z.boolean().optional() }).strict();
const RuleIn = z
  .object({
    active: z.boolean(),
    priority: z.number().int().min(0).max(1000).default(100),
    deliveryFeePoisha: money,
    freeDeliveryMinPoisha: money.nullable().default(null),
    minOrderPoisha: money.default(0),
    codEnabled: z.boolean().default(false),
    codMaxOrderPoisha: z.number().int().positive().max(100_000_000).nullable().default(null),
  })
  .strict();
const TemplateIn = z
  .object({ weekday: z.number().int().min(0).max(6), startsAt: hhmm, endsAt: hhmm, capacity: z.number().int().min(1).max(1000), cutoffMinutes: z.number().int().min(0).max(2880), active: z.boolean().default(true) })
  .strict()
  .refine((t) => t.endsAt > t.startsAt, 'end must be after start');
const SlotPatch = z.object({ capacity: z.number().int().min(1).max(1000).optional(), status: z.enum(['OPEN', 'CLOSED']).optional() }).strict();
const SlotQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict();

/**
 * Delivery configuration (APP_FLOW §2.3 inputs). Areas and zones are global
 * (Super Admin); fees/COD rules per outlet × zone; slots per outlet.
 * Nothing is serviceable until configured (OPEN_DECISIONS D1–D4).
 */
@Controller('admin')
export class DeliveryAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SlotGenerator) private readonly slots: SlotGenerator,
  ) {}

  @Get('areas')
  @RequirePermission('outlets.read')
  areas() {
    return this.prisma.area.findMany({ orderBy: { nameBn: 'asc' } });
  }

  @Post('areas')
  @RequirePermission('delivery.zones_manage')
  async createArea(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(AreaIn, body);
    if (await this.prisma.area.findUnique({ where: { slug: b.slug } })) throw new AppError('CONFLICT', 'Area slug exists');
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.area.create({ data: { id: newId(), ...b } });
      await this.audit.record({ action: 'delivery.area_create', entityType: 'area', entityId: a.id, after: b }, { principal: p }, req, tx);
      return a;
    });
  }

  @Patch('areas/:id')
  @RequirePermission('delivery.zones_manage')
  async updateArea(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(AreaIn.partial().strict(), body);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.area.findUnique({ where: { id } }))) throw notFound('Area');
      const a = await tx.area.update({ where: { id }, data: b });
      await this.audit.record({ action: 'delivery.area_update', entityType: 'area', entityId: id, after: b }, { principal: p }, req, tx);
      return a;
    });
  }

  @Get('zones')
  @RequirePermission('outlets.read')
  zones() {
    return this.prisma.deliveryZone.findMany({ include: { areas: { include: { area: true } } }, orderBy: { name: 'asc' } });
  }

  @Post('zones')
  @RequirePermission('delivery.zones_manage')
  async createZone(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ZoneIn, body);
    return this.prisma.$transaction(async (tx) => {
      const z_ = await tx.deliveryZone.create({ data: { id: newId(), name: b.name, active: b.active ?? true } });
      await tx.deliveryZoneArea.createMany({ data: b.areaIds.map((areaId) => ({ zoneId: z_.id, areaId })) });
      await this.audit.record({ action: 'delivery.zone_create', entityType: 'zone', entityId: z_.id, after: b }, { principal: p }, req, tx);
      return z_;
    });
  }

  @Put('zones/:id')
  @RequirePermission('delivery.zones_manage')
  async updateZone(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(ZoneIn, body);
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.deliveryZone.findUnique({ where: { id } }))) throw notFound('Zone');
      await tx.deliveryZone.update({ where: { id }, data: { name: b.name, active: b.active ?? true } });
      await tx.deliveryZoneArea.deleteMany({ where: { zoneId: id } });
      await tx.deliveryZoneArea.createMany({ data: b.areaIds.map((areaId) => ({ zoneId: id, areaId })) });
      await this.audit.record({ action: 'delivery.zone_update', entityType: 'zone', entityId: id, after: b }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  @Get('outlets/:outletId/zone-rules')
  @RequirePermission('outlets.read')
  rules(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return this.prisma.outletZoneRule.findMany({ where: { outletId }, include: { zone: true } });
  }

  @Put('outlets/:outletId/zone-rules/:zoneId')
  @RequirePermission('delivery.outlet_rules_manage')
  async putRule(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('zoneId', ParseUUIDPipe) zoneId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    const b = parse(RuleIn, body);
    if (!(await this.prisma.deliveryZone.findUnique({ where: { id: zoneId } }))) throw notFound('Zone');
    if (!(await this.prisma.outlet.findUnique({ where: { id: outletId } }))) throw notFound('Outlet');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.outletZoneRule.upsert({ where: { outletId_zoneId: { outletId, zoneId } }, update: b, create: { outletId, zoneId, ...b } });
      await this.audit.record({ action: 'delivery.rule_upsert', entityType: 'outlet_zone_rule', entityId: zoneId, outletId, after: b }, { principal: p }, req, tx);
      return r;
    });
  }

  @Get('outlets/:outletId/slot-templates')
  @RequirePermission('outlets.read')
  templates(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return this.prisma.deliverySlotTemplate.findMany({ where: { outletId }, orderBy: [{ weekday: 'asc' }, { startsAt: 'asc' }] });
  }

  @Post('outlets/:outletId/slot-templates')
  @RequirePermission('delivery.slots_manage')
  async createTemplate(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(TemplateIn, body);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.deliverySlotTemplate.create({
        data: { id: newId(), outletId, weekday: b.weekday, startsAt: timeOfDay(b.startsAt), endsAt: timeOfDay(b.endsAt), capacity: b.capacity, cutoffMinutes: b.cutoffMinutes, active: b.active },
      });
      await this.audit.record({ action: 'delivery.template_create', entityType: 'slot_template', entityId: t.id, outletId, after: b }, { principal: p }, req, tx);
      return t;
    });
  }

  @Patch('outlets/:outletId/slot-templates/:id')
  @RequirePermission('delivery.slots_manage')
  async updateTemplate(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    const b = parse(z.object({ capacity: z.number().int().min(1).max(1000).optional(), cutoffMinutes: z.number().int().min(0).max(2880).optional(), active: z.boolean().optional() }).strict(), body);
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.deliverySlotTemplate.findFirst({ where: { id, outletId } });
      if (!t) throw notFound('Slot template');
      const u = await tx.deliverySlotTemplate.update({ where: { id }, data: b });
      await this.audit.record({ action: 'delivery.template_update', entityType: 'slot_template', entityId: id, outletId, after: b }, { principal: p }, req, tx);
      return u;
    });
  }

  @Post('outlets/:outletId/slots/generate')
  @RequirePermission('delivery.slots_manage')
  @HttpCode(200)
  async generate(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return { created: await this.slots.generate(outletId) };
  }

  @Get('outlets/:outletId/slots')
  @RequirePermission('outlets.read')
  list(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Query() query: unknown) {
    assertOutletInScope(p, outletId);
    const q = parse(SlotQuery, query);
    return this.prisma.deliverySlot.findMany({ where: { outletId, ...(q.date ? { slotDate: new Date(`${q.date}T00:00:00Z`) } : {}) }, orderBy: { startsAt: 'asc' }, take: 200 });
  }

  /** Capacity can never drop below confirmed bookings (CHECK constraint backs this up). */
  @Patch('outlets/:outletId/slots/:slotId')
  @RequirePermission('delivery.slots_manage')
  async patchSlot(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('slotId', ParseUUIDPipe) slotId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    const b = parse(SlotPatch, body);
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.deliverySlot.findFirst({ where: { id: slotId, outletId } });
      if (!s) throw notFound('Slot');
      if (b.capacity !== undefined && b.capacity < s.bookedCount) throw new AppError('CONFLICT', `Capacity cannot be below ${s.bookedCount} existing bookings`);
      const u = await tx.deliverySlot.update({ where: { id: slotId }, data: b });
      await this.audit.record({ action: 'delivery.slot_update', entityType: 'delivery_slot', entityId: slotId, outletId, before: { capacity: s.capacity, status: s.status }, after: b }, { principal: p }, req, tx);
      return u;
    });
  }
}
