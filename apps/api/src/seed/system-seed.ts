import { PERMISSIONS, ROLE_DEFAULTS, type StaffRole } from '@dudhwala/shared';
import { v5 as uuidv5 } from 'uuid';
import type { Tx } from '../prisma/prisma.service.js';

/** Fixed namespace so seeded ids are identical in every environment. */
const NS = '3b0c5d2e-1f4a-4c1b-9a7e-6d2f8c9b0a11';
const sid = (name: string) => uuidv5(name, NS);

const ROLE_NAMES: Record<StaffRole | 'CUSTOMER', string> = {
  SUPER_ADMIN: 'Super Admin',
  OUTLET_MANAGER: 'Outlet Manager',
  OUTLET_STAFF: 'Outlet Staff',
  DELIVERY_STAFF: 'Delivery Staff',
  CUSTOMER: 'Customer',
};

/**
 * Idempotent seed of system roles and permissions — the only seed that runs in
 * production. Contains no business data (OPEN_DECISIONS: nothing invented).
 */
export async function seedSystem(tx: Tx): Promise<void> {
  for (const code of PERMISSIONS) {
    await tx.permission.upsert({ where: { code }, update: {}, create: { id: sid(`perm:${code}`), code, description: code } });
  }
  for (const [code, name] of Object.entries(ROLE_NAMES) as [StaffRole | 'CUSTOMER', string][]) {
    const role = await tx.role.upsert({ where: { code }, update: { name }, create: { id: sid(`role:${code}`), code, name, isSystem: true } });
    if (code === 'CUSTOMER') continue;
    for (const perm of ROLE_DEFAULTS[code]) {
      const permissionId = sid(`perm:${perm}`);
      await tx.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId } }, update: {}, create: { roleId: role.id, permissionId } });
    }
  }
}
