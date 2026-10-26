import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { StaffPrincipal } from '../access/principal.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isSettingKey, SETTINGS, type SettingKey, type SettingValue } from './settings.registry.js';

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Effective value: outlet override (OUTLET keys) → stored global → registry default. */
  async get<K extends SettingKey>(key: K, outletId?: string | null, tx: Tx = this.prisma): Promise<SettingValue<K>> {
    const def = SETTINGS[key];
    const rows = await tx.setting.findMany({
      where: { key, OR: [{ outletId: null }, ...(outletId && def.scope === 'OUTLET' ? [{ outletId }] : [])] },
    });
    const row = rows.find((r) => r.outletId === outletId) ?? rows.find((r) => r.outletId === null);
    if (!row) return def.default as SettingValue<K>;
    const parsed = def.schema.safeParse(row.value);
    // A stored value that no longer validates falls back to the safe default.
    return (parsed.success ? parsed.data : def.default) as SettingValue<K>;
  }

  async list(outletId: string | null): Promise<{ key: string; scope: string; value: unknown; isDefault: boolean; doc: string }[]> {
    const out = [];
    for (const key of Object.keys(SETTINGS) as SettingKey[]) {
      const def = SETTINGS[key];
      if (outletId && def.scope !== 'OUTLET') continue;
      const stored = await this.prisma.setting.findFirst({ where: { key, outletId: outletId ?? null } });
      out.push({ key, scope: def.scope, value: stored?.value ?? def.default, isDefault: !stored, doc: def.doc });
    }
    return out;
  }

  async set(key: string, value: unknown, outletId: string | null, p: StaffPrincipal, req: Request): Promise<void> {
    if (!isSettingKey(key)) throw new AppError('VALIDATION_FAILED', `Unknown setting ${key}`);
    const def = SETTINGS[key];
    if (outletId && def.scope !== 'OUTLET') throw new AppError('VALIDATION_FAILED', `${key} can only be set globally`);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) throw new AppError('VALIDATION_FAILED', `Invalid value for ${key}`, parsed.error.issues.map((i) => i.message));
    const json = parsed.data as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.setting.findFirst({ where: { key, outletId } });
      if (before) await tx.setting.update({ where: { id: before.id }, data: { value: json, updatedById: p.userId } });
      else await tx.setting.create({ data: { id: newId(), key, scope: outletId ? 'OUTLET' : 'GLOBAL', outletId, value: json, updatedById: p.userId } });
      await this.audit.record(
        { action: 'settings.update', entityType: 'setting', entityId: key, outletId, before: (before?.value ?? null) as Prisma.InputJsonValue | null, after: json },
        { principal: p },
        req,
        tx,
      );
    });
  }
}
