import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { tryNormalizeBdMobile } from '@dudhwala/shared';
import { notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CurrentPrincipal, CustomerOnly } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';

export const phoneField = z.string().transform((v, ctx) => {
  const n = tryNormalizeBdMobile(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Bangladeshi mobile number' });
    return z.NEVER;
  }
  return n;
});

export const AddressInput = z
  .object({
    label: z.string().trim().max(40).nullable().optional(),
    recipientName: z.string().trim().min(1).max(120),
    phone: phoneField,
    areaId: z.string().uuid(),
    line1: z.string().trim().min(3).max(200),
    line2: z.string().trim().max(200).nullable().optional(),
    landmark: z.string().trim().max(200).nullable().optional(),
    instructions: z.string().trim().max(300).nullable().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict();

const SELECT = {
  id: true, label: true, recipientName: true, phone: true, line1: true, line2: true, landmark: true, instructions: true, isDefault: true,
  area: { select: { id: true, nameBn: true, nameEn: true, active: true } },
} as const;

/** Customer address book; every query is filtered by the session's user id (404 for others). */
@Controller('me/addresses')
export class AddressesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @CustomerOnly()
  list(@CurrentPrincipal() p: Principal) {
    return this.prisma.address.findMany({ where: { userId: p.userId }, select: SELECT, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
  }

  @Post()
  @CustomerOnly()
  async create(@CurrentPrincipal() p: Principal, @Body() body: unknown) {
    const b = parse(AddressInput, body);
    if (!(await this.prisma.area.findFirst({ where: { id: b.areaId, active: true } }))) throw notFound('Area');
    return this.prisma.$transaction(async (tx) => {
      const first = (await tx.address.count({ where: { userId: p.userId } })) === 0;
      const isDefault = b.isDefault ?? first;
      if (isDefault) await tx.address.updateMany({ where: { userId: p.userId, isDefault: true }, data: { isDefault: false } });
      return tx.address.create({ data: { id: newId(), userId: p.userId, ...b, isDefault }, select: SELECT });
    });
  }

  @Patch(':id')
  @CustomerOnly()
  async update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const b = parse(AddressInput.partial().strict(), body);
    if (b.areaId && !(await this.prisma.area.findFirst({ where: { id: b.areaId, active: true } }))) throw notFound('Area');
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.address.findFirst({ where: { id, userId: p.userId } });
      if (!a) throw notFound('Address');
      if (b.isDefault) await tx.address.updateMany({ where: { userId: p.userId, isDefault: true, NOT: { id } }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: b, select: SELECT });
    });
  }

  @Delete(':id')
  @CustomerOnly()
  @HttpCode(204)
  async remove(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    const r = await this.prisma.address.deleteMany({ where: { id, userId: p.userId } });
    if (r.count === 0) throw notFound('Address');
  }
}
