import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/errors.js';
import { SessionService } from '../auth/session.service.js';
import { ACCESS_KEY, type AccessRule } from './decorators.js';
import { requiresMfa } from './principal.js';

/**
 * Global guard. Resolves the session and enforces the route's declared access
 * rule. A route with no rule is a programming error and is denied.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!rule) throw new AppError('FORBIDDEN', 'Route has no access rule');

    const req = ctx.switchToHttp().getRequest<Request>();
    // Storefront clients send x-dw-audience: customer so a staff cookie in the same browser is ignored.
    const audience =
      rule.type === 'customer' || (rule.type === 'public' && (rule.audience === 'CUSTOMER' || req.header('x-dw-audience') === 'customer')) ? 'CUSTOMER' : 'STAFF';
    const principal = await this.sessions.resolve(req, audience);
    if (principal) req.principal = principal;

    if (rule.type === 'public') return true;
    if (!principal) throw new AppError('UNAUTHENTICATED', 'Login required');

    if (rule.type === 'customer') {
      if (principal.kind !== 'CUSTOMER') throw new AppError('FORBIDDEN', 'Customer account required');
      return true;
    }

    if (principal.kind !== 'STAFF') throw new AppError('FORBIDDEN', 'Staff account required');
    const mfaOk = principal.mfaVerified || !requiresMfa(principal);
    if (rule.type === 'staff-any') {
      if (!mfaOk && !rule.allowWithoutMfa) throw new AppError('MFA_REQUIRED', 'Two-factor verification required');
      return true;
    }
    if (!mfaOk) throw new AppError('MFA_REQUIRED', 'Two-factor verification required');
    if (!principal.staff.permissions.has(rule.permission)) throw new AppError('FORBIDDEN', 'Permission denied');
    return true;
  }
}
