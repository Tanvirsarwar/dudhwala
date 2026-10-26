import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { normalizeBdMobile, ROLE_OPTIONAL, type OutletRole } from '@dudhwala/shared';
import { AppError, notFound } from '../common/errors.js';
import { newId } from '../common/crypto.js';
import { parse } from '../common/http.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentPrincipal, RequirePermission } from '../access/decorators.js';
import { assertOutletInScope, outletScope, type StaffPrincipal } from '../access/principal.js';
import { SessionService } from '../auth/session.service.js';
import { StaffAuthService } from '../auth/staff-auth.service.js';

const phone = z.string().transform((v, ctx) => {
  try {
    return normalizeBdMobile(v);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Bangladeshi mobile number' });
    return z.NEVER;
  }
});

const CreateOutlet = z
  .object({
    code: z.string().regex(/^[A-Z0-9-]{2,16}$/),
    nameBn: z.string().min(1).max(120),
    nameEn: z.string().max(120).optional(),
    addressLine: z.string().min(1).max(300),
    phone: phone.optional(),
    email: z.string().email().optional(),
  })
  .strict();

const UpdateOutlet = z
  .object({
    nameBn: z.string().min(1).max(120).optional(),
    nameEn: z.string().max(120).nullable().optional(),
    addressLine: z.string().min(1).max(300).optional(),
    phone: phone.nullable().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']).optional(),
    acceptsOnlineOrders: z.boolean().optional(),
    autoConfirmOrders: z.boolean().optional(),
  })
  .strict();

const CreateStaff = z
  .object({
    fullName: z.string().min(1).max(120),
    email: z.string().email().optional(),
    phone: phone.optional(),
    role: z.enum(['OUTLET_MANAGER', 'OUTLET_STAFF', 'DELIVERY_STAFF']),
    temporaryPassword: z.string().min(12).max(256),
    extraPermissions: z.array(z.string()).max(20).default([]),
  })
  .strict()
  .refine((v) => v.email || v.phone, 'email or phone is required');

const ResetCredentials = z
  .object({ temporaryPassword: z.string().min(12).max(256).optional(), resetMfa: z.boolean().default(false) })
  .strict()
  .refine((v) => v.temporaryPassword || v.resetMfa, 'set a temporary password, reset two-factor, or both');

const OUTLET_PUBLIC_FIELDS = {
  id: true, code: true, nameBn: true, nameEn: true, addressLine: true, phone: true, email: true,
  status: true, acceptsOnlineOrders: true, autoConfirmOrders: true, createdAt: true, updatedAt: true,
} as const;

@Controller('admin/outlets')
export class OutletsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get()
  @RequirePermission('outlets.read')
  list(@CurrentPrincipal() p: StaffPrincipal) {
    const scope = outletScope(p);
    return this.prisma.outlet.findMany({
      where: scope === 'ALL' ? {} : { id: { in: [...scope] } },
      select: OUTLET_PUBLIC_FIELDS,
      orderBy: { code: 'asc' },
    });
  }

  @Get(':outletId')
  @RequirePermission('outlets.read')
  async get(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    assertOutletInScope(p, outletId);
    const o = await this.prisma.outlet.findUnique({ where: { id: outletId }, select: OUTLET_PUBLIC_FIELDS });
    if (!o) throw notFound('Outlet');
    return o;
  }

  @Post()
  @RequirePermission('outlets.manage')
  async create(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    const b = parse(CreateOutlet, body);
    if (await this.prisma.outlet.findUnique({ where: { code: b.code } })) throw new AppError('CONFLICT', 'Outlet code already exists');
    return this.prisma.$transaction(async (tx) => {
      // New outlets start PAUSED and not accepting orders until configured (OPEN_DECISIONS C1/C2).
      const o = await tx.outlet.create({ data: { id: newId(), ...b, status: 'PAUSED', acceptsOnlineOrders: false }, select: OUTLET_PUBLIC_FIELDS });
      await this.audit.record({ action: 'outlet.create', entityType: 'outlet', entityId: o.id, outletId: o.id, after: { code: o.code } }, { principal: p }, req, tx);
      return o;
    });
  }

  @Patch(':outletId')
  @RequirePermission('outlets.manage')
  async update(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    const b = parse(UpdateOutlet, body);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.outlet.findUnique({ where: { id: outletId }, select: OUTLET_PUBLIC_FIELDS });
      if (!before) throw notFound('Outlet');
      const after = await tx.outlet.update({ where: { id: outletId }, data: b, select: OUTLET_PUBLIC_FIELDS });
      await this.audit.record(
        { action: 'outlet.update', entityType: 'outlet', entityId: outletId, outletId, before: JSON.parse(JSON.stringify(before)), after: b },
        { principal: p },
        req,
        tx,
      );
      return after;
    });
  }

  @Get(':outletId/staff')
  @RequirePermission('outlets.read')
  async listStaff(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string) {
    if (p.staff.role !== 'SUPER_ADMIN' && p.staff.role !== 'OUTLET_MANAGER') throw new AppError('FORBIDDEN', 'Permission denied');
    assertOutletInScope(p, outletId);
    const rows = await this.prisma.outletStaff.findMany({
      where: { outletId },
      include: { role: true, user: { select: { id: true, fullName: true, email: true, phone: true, status: true, mfaEnabled: true, lastLoginAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ assignmentId: r.id, role: r.role.code, active: r.active, extraPermissions: r.extraPermissions, user: r.user }));
  }

  /**
   * Super Admin may create any outlet role. A manager with `staff.manage_outlet`
   * may create only OUTLET_STAFF and DELIVERY_STAFF at their own outlet.
   */
  @Post(':outletId/staff')
  @RequirePermission('staff.manage_outlet')
  async createStaff(@CurrentPrincipal() p: StaffPrincipal, @Param('outletId', ParseUUIDPipe) outletId: string, @Body() body: unknown, @Req() req: Request) {
    assertOutletInScope(p, outletId);
    const b = parse(CreateStaff, body);
    if (p.staff.role !== 'SUPER_ADMIN' && b.role === 'OUTLET_MANAGER') throw new AppError('FORBIDDEN', 'Only a Super Admin can create managers');
    const ceiling = ROLE_OPTIONAL[b.role as OutletRole] as readonly string[];
    const bad = b.extraPermissions.filter((x) => !ceiling.includes(x));
    if (bad.length) throw new AppError('VALIDATION_FAILED', 'Permissions not allowed for this role', bad);
    const outlet = await this.prisma.outlet.findUnique({ where: { id: outletId } });
    if (!outlet) throw notFound('Outlet');
    const email = b.email?.toLowerCase();
    const clash = await this.prisma.user.findFirst({ where: { OR: [email ? { email } : {}, b.phone ? { phone: b.phone } : {}].filter((o) => Object.keys(o).length) } });
    if (clash) throw new AppError('CONFLICT', 'A user with this email or phone already exists');
    const passwordHash = await StaffAuthService.hashPassword(b.temporaryPassword);

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { code: b.role } });
      const user = await tx.user.create({
        data: { id: newId(), kind: 'STAFF', fullName: b.fullName, email: email ?? null, phone: b.phone ?? null, passwordHash },
      });
      const a = await tx.outletStaff.create({
        data: { id: newId(), userId: user.id, outletId, roleId: role.id, extraPermissions: b.extraPermissions, grantedById: p.userId },
      });
      await this.audit.record(
        { action: 'staff.create', entityType: 'user', entityId: user.id, outletId, after: { role: b.role, extraPermissions: b.extraPermissions } },
        { principal: p },
        req,
        tx,
      );
      return { userId: user.id, assignmentId: a.id, role: b.role };
    });
  }

  @Post(':outletId/staff/:assignmentId/deactivate')
  @RequirePermission('staff.manage_outlet')
  @HttpCode(200)
  async deactivate(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.outletStaff.findFirst({ where: { id: assignmentId, outletId }, include: { role: true } });
      if (!a) throw notFound('Staff assignment');
      if (p.staff.role !== 'SUPER_ADMIN' && a.role.code === 'OUTLET_MANAGER') throw new AppError('FORBIDDEN', 'Only a Super Admin can deactivate managers');
      await tx.outletStaff.update({ where: { id: a.id }, data: { active: false } });
      await this.sessions.revokeAllForUser(a.userId, tx);
      await this.audit.record({ action: 'staff.deactivate', entityType: 'user', entityId: a.userId, outletId }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  @Post(':outletId/staff/:assignmentId/activate')
  @RequirePermission('staff.manage_outlet')
  @HttpCode(200)
  async activate(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.outletStaff.findFirst({ where: { id: assignmentId, outletId }, include: { role: true } });
      if (!a) throw notFound('Staff assignment');
      if (p.staff.role !== 'SUPER_ADMIN' && a.role.code === 'OUTLET_MANAGER') throw new AppError('FORBIDDEN', 'Only a Super Admin can reactivate managers');
      await tx.outletStaff.update({ where: { id: a.id }, data: { active: true } });
      await this.audit.record({ action: 'staff.activate', entityType: 'user', entityId: a.userId, outletId }, { principal: p }, req, tx);
      return { ok: true };
    });
  }

  /**
   * Lost password or authenticator (OPERATIONS_GUIDE §6.1): sets a new temporary password
   * and/or clears two-factor so the person enrols again at next login. All their sessions end.
   * Super Admin for anyone at the outlet; a manager with staff.manage_outlet for staff and riders only.
   */
  @Post(':outletId/staff/:assignmentId/reset-credentials')
  @RequirePermission('staff.manage_outlet')
  @HttpCode(200)
  async resetCredentials(
    @CurrentPrincipal() p: StaffPrincipal,
    @Param('outletId', ParseUUIDPipe) outletId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    assertOutletInScope(p, outletId);
    const b = parse(ResetCredentials, body);
    const a = await this.prisma.outletStaff.findFirst({ where: { id: assignmentId, outletId }, include: { role: true } });
    if (!a) throw notFound('Staff assignment');
    if (p.staff.role !== 'SUPER_ADMIN' && a.role.code === 'OUTLET_MANAGER') throw new AppError('FORBIDDEN', 'Only a Super Admin can reset a manager');
    if (a.userId === p.userId) throw new AppError('FORBIDDEN', 'Use “change password” for your own account');
    const passwordHash = b.temporaryPassword ? await StaffAuthService.hashPassword(b.temporaryPassword) : undefined;
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: a.userId },
        data: { ...(passwordHash ? { passwordHash } : {}), ...(b.resetMfa ? { mfaEnabled: false, mfaTotpSecretEnc: null, mfaLastStep: null } : {}) },
      });
      if (b.resetMfa) await tx.mfaRecoveryCode.deleteMany({ where: { userId: a.userId } });
      await this.sessions.revokeAllForUser(a.userId, tx);
      await this.audit.record(
        { action: 'staff.reset_credentials', entityType: 'user', entityId: a.userId, outletId, after: { password: Boolean(passwordHash), mfa: b.resetMfa } },
        { principal: p },
        req,
        tx,
      );
      return { ok: true };
    });
  }
}
