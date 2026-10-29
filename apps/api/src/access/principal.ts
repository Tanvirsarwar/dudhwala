export type StaffRole = 'ADMIN' | 'MANAGER';

export type Principal =
  | { kind: 'CUSTOMER'; userId: string; sessionId: string }
  | { kind: 'STAFF'; userId: string; sessionId: string; role: StaffRole; mfaEnabled: boolean; mfaVerified: boolean };

export type StaffPrincipal = Extract<Principal, { kind: 'STAFF' }>;

/** ADMIN must always use two-factor; a MANAGER only once they have enrolled. */
export function requiresMfa(p: StaffPrincipal): boolean {
  return p.role === 'ADMIN' || p.mfaEnabled;
}

export const principalRole = (p: Principal): string => (p.kind === 'CUSTOMER' ? 'CUSTOMER' : p.role);
