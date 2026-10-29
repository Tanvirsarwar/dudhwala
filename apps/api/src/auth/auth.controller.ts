import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { tryNormalizeBdMobile } from '@dudhwala/shared';
import { AppError } from '../common/errors.js';
import { parse } from '../common/http.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CSRF_COOKIE, issueCsrfToken } from '../access/csrf.js';
import { CurrentPrincipal, Public, StaffRead } from '../access/decorators.js';
import type { Principal, StaffPrincipal } from '../access/principal.js';
import { OtpService } from './otp.service.js';
import { SessionService } from './session.service.js';
import { StaffAuthService } from './staff-auth.service.js';
import { CartService } from '../cart/cart.service.js';

const OtpRequest = z.object({ phone: z.string().min(10).max(20) }).strict();
const OtpVerify = z.object({ challengeId: z.string().uuid(), code: z.string().min(4).max(12) }).strict();
const StaffLogin = z.object({ login: z.string().min(3).max(120), password: z.string().min(1).max(256), as: z.enum(['admin', 'manager']).optional() }).strict();
const MfaCode = z.object({ code: z.string().min(6).max(16) }).strict();
const ChangePassword = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) }).strict();

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(OtpService) private readonly otp: OtpService,
    @Inject(StaffAuthService) private readonly staff: StaffAuthService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CartService) private readonly carts: CartService,
  ) {}

  @Get('csrf')
  @Public()
  csrf(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const token = issueCsrfToken(this.env.SESSION_SECRET);
    const secure = this.env.NODE_ENV === 'production' || this.env.NODE_ENV === 'staging';
    res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
    return { csrfToken: token };
  }

  @Post('otp/request')
  @Public()
  @HttpCode(200)
  requestOtp(@Body() body: unknown, @Req() req: Request) {
    return this.otp.request(parse(OtpRequest, body).phone, req);
  }

  @Post('otp/verify')
  @Public()
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const b = parse(OtpVerify, body);
    const r = await this.otp.verify(b.challengeId, b.code, req, res);
    await this.carts.mergeOnLogin(r.userId, req, res);
    return { user: { id: r.userId }, isNew: r.isNew };
  }

  @Post('staff/login')
  @Public()
  @HttpCode(200)
  staffLogin(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const b = parse(StaffLogin, body);
    // Staff may type a phone number in local form (017…); stored numbers are E.164.
    const login = tryNormalizeBdMobile(b.login) ?? b.login.trim().toLowerCase();
    return this.staff.login(login, b.password, b.as === 'manager' ? 'MANAGER' : 'ADMIN', req, res);
  }

  @Post('staff/mfa/enroll')
  @StaffRead({ allowWithoutMfa: true })
  @HttpCode(200)
  enroll(@CurrentPrincipal() p: StaffPrincipal, @Req() req: Request) {
    return this.staff.beginEnrollment(p, req);
  }

  @Post('staff/mfa/confirm')
  @StaffRead({ allowWithoutMfa: true })
  @HttpCode(200)
  confirm(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request) {
    return this.staff.confirmEnrollment(p, parse(MfaCode, body).code, req);
  }

  @Post('staff/mfa')
  @StaffRead({ allowWithoutMfa: true })
  @HttpCode(204)
  async mfa(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request): Promise<void> {
    await this.staff.verifyMfa(p, parse(MfaCode, body).code, req);
  }

  @Post('staff/password')
  @StaffRead()
  @HttpCode(204)
  async changePassword(@CurrentPrincipal() p: StaffPrincipal, @Body() body: unknown, @Req() req: Request): Promise<void> {
    const b = parse(ChangePassword, body);
    await this.staff.changePassword(p, b.currentPassword, b.newPassword, req);
  }

  /** Logs out the session for the calling app (admin by default; storefront sends x-dw-audience: customer). */
  @Post('logout')
  @Public()
  @HttpCode(204)
  async logout(@CurrentPrincipal() p: Principal | undefined, @Res({ passthrough: true }) res: Response): Promise<void> {
    if (p) await this.sessions.revoke(p.sessionId);
    this.sessions.clearCookies(res, p?.kind);
  }
}

@Controller('me')
export class MeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async me(@CurrentPrincipal() p: Principal | undefined) {
    if (!p) throw new AppError('UNAUTHENTICATED', 'Login required');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: p.userId },
      select: { id: true, fullName: true, email: true, phone: true, mfaEnabled: true },
    });
    if (p.kind === 'CUSTOMER') return { user, role: 'CUSTOMER' };
    return { user, role: p.role, canEdit: p.role === 'ADMIN', mfaVerified: p.mfaVerified };
  }
}
