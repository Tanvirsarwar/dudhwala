import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@dudhwala/shared';
import type { Request } from 'express';
import './request-augment.js';

/**
 * Every route must declare exactly one access rule. Routes without one are
 * denied by AccessGuard (fail closed — SECURITY_REVIEW §3).
 */
export const ACCESS_KEY = 'dw:access';
export type AccessRule =
  | { type: 'public'; audience?: 'CUSTOMER' }
  | { type: 'customer' }
  | { type: 'staff-any'; allowWithoutMfa?: boolean }
  | { type: 'permission'; permission: Permission };

/** `audience: 'CUSTOMER'` for storefront routes that must ignore a staff cookie (e.g. cart). */
export const Public = (opts: { audience?: 'CUSTOMER' } = {}) => SetMetadata(ACCESS_KEY, { type: 'public', ...opts } satisfies AccessRule);
export const CustomerOnly = () => SetMetadata(ACCESS_KEY, { type: 'customer' } satisfies AccessRule);
/** Any authenticated staff member; `allowWithoutMfa` only for MFA enrolment/verification routes. */
export const StaffAny = (opts: { allowWithoutMfa?: boolean } = {}) =>
  SetMetadata(ACCESS_KEY, { type: 'staff-any', ...opts } satisfies AccessRule);
export const RequirePermission = (permission: Permission) =>
  SetMetadata(ACCESS_KEY, { type: 'permission', permission } satisfies AccessRule);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().principal;
});
