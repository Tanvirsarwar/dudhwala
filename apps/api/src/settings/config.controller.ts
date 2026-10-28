import { Body, Controller, Get, HttpCode, Inject, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { hhmmToMinutes, minutesToHHMM } from '@dudhwala/shared';
import { CurrentPrincipal, Public, StaffRead, StaffWrite } from '../access/decorators.js';
import type { StaffPrincipal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from './settings.service.js';

const UpdateConfig = z
  .object({
    hours: z.object({ open: z.string(), close: z.string() }).strict(),
    bulk: z.object({ minTotalQuantity: z.number().int().min(1).max(100_000), minTotalTaka: z.number().int().min(1).max(100_000_000) }).strict(),
  })
  .strict();

@Controller()
export class ConfigController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private async view() {
    const { config, bulkApproved } = await this.settings.ordering();
    return { hours: config.hours, bulk: { ...config.bulk, isPlaceholder: !bulkApproved } };
  }

  /** Public: ordering hours and bulk thresholds (the storefront shows and pre-checks them; the server enforces them). */
  @Get('config')
  @Public()
  config() {
    return this.view();
  }

  @Get('admin/config')
  @StaffRead()
  adminConfig() {
    return this.view();
  }

  /** Saving real values is the owner's approval of the thresholds: the placeholder flag is cleared. */
  @Put('admin/config')
  @StaffWrite()
  @HttpCode(200)
  async update(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(UpdateConfig, body);
    const open = hhmmToMinutes(b.hours.open);
    const close = hhmmToMinutes(b.hours.close);
    if (open === null || close === null || open >= close) throw new AppError('VALIDATION_FAILED', 'Opening time must be before closing time (HH:MM)');
    const before = await this.view();
    await this.prisma.$transaction(async (tx) => {
      await this.settings.set('ordering.hours', { openMinute: open, closeMinute: close }, p.userId, tx);
      await this.settings.set('bulk.rule', { minTotalQuantity: b.bulk.minTotalQuantity, minTotalPoisha: b.bulk.minTotalTaka * 100, approved: true }, p.userId, tx);
      await this.audit.record(
        { action: 'config.update', entityType: 'setting', entityId: 'ordering', before, after: { hours: { open: minutesToHHMM(open), close: minutesToHHMM(close) }, bulk: b.bulk } },
        { principal: p },
        req,
        tx,
      );
    });
    return this.view();
  }
}
