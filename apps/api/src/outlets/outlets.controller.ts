import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { hhmmToMinutes } from '@dudhwala/shared';
import { CurrentPrincipal, Public, StaffRead, StaffWrite } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { OutletsService } from './outlets.service.js';

const OutletPatch = z
  .object({
    nameBn: z.string().trim().min(1).max(120).optional(),
    nameEn: z.string().trim().min(1).max(120).nullable().optional(),
    addressLine: z.string().trim().min(1).max(300).optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
  })
  .strict();
const HoursPut = z
  .object({
    hours: z
      .array(z.object({ weekday: z.number().int().min(0).max(6), opens: z.string(), closes: z.string() }).strict())
      .max(7)
      .refine((h) => new Set(h.map((x) => x.weekday)).size === h.length, 'one row per weekday'),
  })
  .strict();
const RolesPut = z.object({ dispatchOutletId: z.string().uuid().nullable().optional(), collectionOutletId: z.string().uuid().nullable().optional() }).strict();

@Controller()
export class OutletsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutletsService) private readonly outlets: OutletsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Outlets a customer can pick up from. The bulk collection outlet is listed too; bulk orders ignore this list. */
  @Get('outlets')
  @Public()
  async list() {
    const rows = await this.prisma.outlet.findMany({ where: { status: 'ACTIVE' }, include: { hours: true }, orderBy: { code: 'asc' } });
    return rows.map((o) => this.outlets.view(o));
  }

  @Get('admin/outlets')
  @StaffRead()
  async adminList() {
    const [rows, dispatch, collection] = await Promise.all([
      this.prisma.outlet.findMany({ include: { hours: true }, orderBy: { code: 'asc' } }),
      this.settings.get('fulfilment.dispatchOutletId'),
      this.settings.get('bulk.collectionOutletId'),
    ]);
    return { data: rows.map((o) => this.outlets.view(o)), dispatchOutletId: dispatch, collectionOutletId: collection };
  }

  @Patch('admin/outlets/:id')
  @StaffWrite()
  async patch(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(OutletPatch, body);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.outlet.findUnique({ where: { id } });
      if (!before) throw notFound('Outlet');
      const o = await tx.outlet.update({ where: { id }, data: b, include: { hours: true } });
      await this.audit.record({ action: 'outlet.update', entityType: 'outlet', entityId: id, before: { status: before.status, nameBn: before.nameBn }, after: b }, { principal: p }, req, tx);
      return this.outlets.view(o);
    });
  }

  @Put('admin/outlets/:id/hours')
  @StaffWrite()
  async putHours(@CurrentPrincipal() p: StaffPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(HoursPut, body);
    for (const h of b.hours) {
      const o = hhmmToMinutes(h.opens);
      const c = hhmmToMinutes(h.closes);
      if (o === null || c === null || o >= c) throw new AppError('VALIDATION_FAILED', 'Opening time must be before closing time (HH:MM)');
    }
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.outlet.findUnique({ where: { id } }))) throw notFound('Outlet');
      await this.outlets.replaceHours(tx, id, b.hours);
      await this.audit.record({ action: 'outlet.hours', entityType: 'outlet', entityId: id, after: { hours: b.hours } }, { principal: p }, req, tx);
      return this.outlets.view(await tx.outlet.findUniqueOrThrow({ where: { id }, include: { hours: true } }));
    });
  }

  /** Which outlet supplies home delivery, and which one is the bulk collection point (Modina Market Branch). */
  @Put('admin/fulfilment-outlets')
  @StaffWrite()
  async putRoles(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(RolesPut, body);
    return this.prisma.$transaction(async (tx) => {
      for (const id of [b.dispatchOutletId, b.collectionOutletId]) {
        if (id && !(await tx.outlet.findUnique({ where: { id } }))) throw notFound('Outlet');
      }
      if (b.dispatchOutletId !== undefined) await this.settings.set('fulfilment.dispatchOutletId', b.dispatchOutletId, p.userId, tx);
      if (b.collectionOutletId !== undefined) await this.settings.set('bulk.collectionOutletId', b.collectionOutletId, p.userId, tx);
      await this.audit.record({ action: 'outlet.roles', entityType: 'setting', entityId: 'fulfilment-outlets', after: b }, { principal: p }, req, tx);
      return { dispatchOutletId: await this.settings.get('fulfilment.dispatchOutletId', tx), collectionOutletId: await this.settings.get('bulk.collectionOutletId', tx) };
    });
  }
}
