import type { Permission, StaffRole } from '@dudhwala/shared';
import { MFA_REQUIRED_ROLES } from '@dudhwala/shared';
import { AppError, notFound } from '../common/errors.js';

export type Principal =
  | { kind: 'CUSTOMER'; userId: string; sessionId: string }
  | {
      kind: 'STAFF';
      userId: string;
      sessionId: string;
      mfaVerified: boolean;
      staff: {
        role: StaffRole;
        /** null only for SUPER_ADMIN, who is not bound to an outlet. */
        outletId: string | null;
        permissions: ReadonlySet<Permission>;
      };
    };

export type StaffPrincipal = Extract<Principal, { kind: 'STAFF' }>;

export function requiresMfa(p: StaffPrincipal): boolean {
  return MFA_REQUIRED_ROLES.has(p.staff.role);
}

/**
 * Outlet scope (TRD §5.7): 'ALL' for Super Admin, otherwise the single assigned
 * outlet (OPEN_DECISIONS C5). Used to build every outlet-owned query.
 */
export function outletScope(p: StaffPrincipal): 'ALL' | readonly [string] {
  if (p.staff.role === 'SUPER_ADMIN') return 'ALL';
  if (!p.staff.outletId) throw new AppError('FORBIDDEN', 'No outlet assignment');
  return [p.staff.outletId];
}

/** Throws NOT_FOUND (never FORBIDDEN) when the outlet is outside the caller's scope. */
export function assertOutletInScope(p: StaffPrincipal, outletId: string): void {
  const scope = outletScope(p);
  if (scope !== 'ALL' && scope[0] !== outletId) throw notFound('Outlet');
}

/** Prisma `where` fragment restricting outletId to the caller's scope. */
export function outletWhere(p: StaffPrincipal): { outletId?: { in: string[] } } {
  const scope = outletScope(p);
  return scope === 'ALL' ? {} : { outletId: { in: [...scope] } };
}
