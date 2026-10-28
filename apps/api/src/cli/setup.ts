/**
 * One-time (re-runnable) setup from a file the OWNER supplies: outlets with their real addresses and hours, the outlet
 * that supplies home delivery, and the bulk collection outlet (Modina Market Branch). Nothing here is invented: with
 * no file, no outlets exist and home delivery / pickup / bulk stay unavailable.
 *
 *   DATABASE_URL=… node dist/cli/setup.js --file ./owner-setup.json
 *
 * See apps/api/data/setup.example.json for the shape. Existing outlets are matched by `code` and updated; nothing is deleted.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { hhmmToMinutes } from '@dudhwala/shared';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutletsService } from '../outlets/outlets.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { newId } from '../common/crypto.js';

const Hours = z.object({ weekday: z.number().int().min(0).max(6), opens: z.string(), closes: z.string() }).strict();
export const SetupFile = z
  .object({
    outlets: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Z0-9-]{2,32}$/),
            nameBn: z.string().min(1),
            nameEn: z.string().min(1).optional(),
            addressLine: z.string().min(1),
            phone: z.string().optional(),
            status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).default('ACTIVE'),
            hours: z.array(Hours).max(7).optional(),
          })
          .strict(),
      )
      .min(1),
    /** Code of the outlet whose stock supplies home delivery. */
    dispatchOutletCode: z.string().optional(),
    /** Code of the bulk collection outlet (Modina Market Branch). */
    collectionOutletCode: z.string().optional(),
  })
  .strict();
export type SetupFile = z.infer<typeof SetupFile>;

export async function applySetup(prisma: PrismaService, raw: unknown): Promise<{ outlets: number; dispatch: string | null; collection: string | null }> {
  const file = SetupFile.parse(raw);
  const codes = new Set(file.outlets.map((o) => o.code));
  for (const c of [file.dispatchOutletCode, file.collectionOutletCode]) if (c && !codes.has(c)) throw new Error(`Unknown outlet code in setup file: ${c}`);
  for (const o of file.outlets) for (const h of o.hours ?? []) if ((hhmmToMinutes(h.opens) ?? 1e9) >= (hhmmToMinutes(h.closes) ?? -1)) throw new Error(`Bad hours for ${o.code}`);
  const outlets = new OutletsService(prisma);
  const settings = new SettingsService(prisma);
  return prisma.$transaction(async (tx) => {
    const ids = new Map<string, string>();
    for (const o of file.outlets) {
      const data = { nameBn: o.nameBn, nameEn: o.nameEn ?? null, addressLine: o.addressLine, phone: o.phone ?? null, status: o.status };
      const row = await tx.outlet.upsert({ where: { code: o.code }, create: { id: newId(), code: o.code, ...data }, update: data });
      ids.set(o.code, row.id);
      if (o.hours) await outlets.replaceHours(tx, row.id, o.hours);
    }
    if (file.dispatchOutletCode) await settings.set('fulfilment.dispatchOutletId', ids.get(file.dispatchOutletCode) as string, null, tx);
    if (file.collectionOutletCode) await settings.set('bulk.collectionOutletId', ids.get(file.collectionOutletCode) as string, null, tx);
    await tx.auditLog.create({ data: { id: newId(), actorRole: 'CLI', action: 'setup.applied', entityType: 'setting', entityId: 'setup', after: { outlets: file.outlets.map((o) => o.code) } } });
    return { outlets: file.outlets.length, dispatch: file.dispatchOutletCode ?? null, collection: file.collectionOutletCode ?? null };
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  const url = process.env.DATABASE_URL;
  if (!values.file || !url) {
    console.error('Usage: DATABASE_URL=… setup --file <owner-setup.json>');
    process.exit(2);
  }
  const prisma = new PrismaService({ DATABASE_URL: url, DATABASE_CA_CERT: process.env.DATABASE_CA_CERT ?? '' } as Env);
  try {
    const r = await applySetup(prisma, JSON.parse(readFileSync(values.file, 'utf8')));
    console.log(`Setup applied: ${r.outlets} outlet(s); dispatch=${r.dispatch ?? '(unchanged)'}; collection=${r.collection ?? '(unchanged)'}.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
