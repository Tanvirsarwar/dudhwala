import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Put, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { parse } from '../common/http.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, type StaffPrincipal } from '../access/principal.js';
import { SettingsService } from './settings.service.js';

const Put_ = z.object({ value: z.unknown() }).strict();

@Controller('admin')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('settings')
  @RequirePermission('settings.global')
  listGlobal() {
    return this.settings.list(null);
  }

  @Put('settings/:key')
  @RequirePermission('settings.global')
  @HttpCode(204)
  async setGlobal(@CurrentPrincipal() p: StaffPrincipal, @Param('key') key: string, @Body() body: unknown, @Req() req: Request) {
    await this.settings.set(key, parse(Put_, body).value, null, p, req);
  }

  @Get('outlets/:outletId/settings')
  @RequirePermission('settings.outlet')
  listOutlet(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    return this.settings.list(outletId);
  }

  @Put('outlets/:outletId/settings/:key')
  @RequirePermission('settings.outlet')
  @HttpCode(204)
  async setOutlet(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('key') key: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    await this.settings.set(key, parse(Put_, body).value, outletId, p, req);
  }
}
