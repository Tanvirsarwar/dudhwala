import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import './request-augment.js';

/**
 * Every route must declare exactly one access rule. Routes without one are
 * denied by AccessGuard (fail closed).
 */
export const ACCESS_KEY = 'dw:access';
export type AccessRule =
  | { type: 'public'; audience?: 'CUSTOMER' }
  | { type: 'customer' }
  /** Any signed-in staff member (ADMIN or MANAGER). `allowWithoutMfa` only for MFA enrolment/verification routes. */
  | { type: 'staff-read'; allowWithoutMfa?: boolean }
  /** ADMIN only; a MANAGER gets 403 READ_ONLY. */
  | { type: 'staff-write' };

/** `audience: 'CUSTOMER'` for storefront routes that must ignore a staff cookie (e.g. cart). */
export const Public = (opts: { audience?: 'CUSTOMER' } = {}) => SetMetadata(ACCESS_KEY, { type: 'public', ...opts } satisfies AccessRule);
export const CustomerOnly = () => SetMetadata(ACCESS_KEY, { type: 'customer' } satisfies AccessRule);
export const StaffRead = (opts: { allowWithoutMfa?: boolean } = {}) => SetMetadata(ACCESS_KEY, { type: 'staff-read', ...opts } satisfies AccessRule);
export const StaffWrite = () => SetMetadata(ACCESS_KEY, { type: 'staff-write' } satisfies AccessRule);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().principal;
});
