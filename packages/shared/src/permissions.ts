/**
 * Permission catalogue and role defaults (USER_ROLES_AND_PERMISSIONS.md §3).
 * DEFAULTS = granted on assignment. CEILING = the most a role may be granted
 * through outlet_staff.extra_permissions (the ⚙ items).
 */

export const PERMISSIONS = [
  'catalog.read_admin',
  'catalog.manage',
  'catalog.publish',
  'pricing.manage_global',
  'content.manage',
  'outlets.manage',
  'outlets.read',
  'outlets.hours_manage',
  'staff.manage_all',
  'staff.manage_outlet',
  'roles.manage',
  'inventory.read',
  'inventory.receive',
  'inventory.adjust',
  'inventory.write_off',
  'inventory.thresholds',
  'inventory.count',
  'inventory.transfer_request',
  'inventory.transfer_approve',
  'inventory.transfer_receive',
  'orders.read',
  'orders.confirm',
  'orders.reject',
  'orders.prepare',
  'orders.cancel',
  'orders.reschedule',
  'orders.export_csv',
  'orders.view_customer_contact',
  'delivery.zones_manage',
  'delivery.outlet_rules_manage',
  'delivery.slots_manage',
  'delivery.assign',
  'delivery.update_status',
  'delivery.record_attempt',
  'delivery.upload_proof',
  'payments.read',
  'payments.read_raw_events',
  'payments.reconcile',
  'payments.refund',
  'cod.record_collection',
  'cod.confirm_handover',
  'cod.resolve_discrepancy',
  'coupons.manage',
  'reports.consolidated',
  'reports.outlet',
  'audit.read',
  'settings.global',
  'settings.outlet',
  'notifications.configure',
  'customers.privacy',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type StaffRole = 'SUPER_ADMIN' | 'OUTLET_MANAGER' | 'OUTLET_STAFF' | 'DELIVERY_STAFF';
export type OutletRole = Exclude<StaffRole, 'SUPER_ADMIN'>;

const MANAGER_DEFAULTS: readonly Permission[] = [
  'catalog.read_admin',
  'outlets.read',
  'outlets.hours_manage',
  'inventory.read',
  'inventory.receive',
  'inventory.adjust',
  'inventory.write_off',
  'inventory.thresholds',
  'inventory.count',
  'inventory.transfer_request',
  'inventory.transfer_receive',
  'orders.read',
  'orders.confirm',
  'orders.reject',
  'orders.prepare',
  'orders.cancel',
  'orders.reschedule',
  'orders.view_customer_contact',
  'delivery.slots_manage',
  'delivery.assign',
  'delivery.update_status',
  'delivery.record_attempt',
  'payments.read',
  'cod.confirm_handover',
  'reports.outlet',
  'audit.read',
  'settings.outlet',
];

const STAFF_DEFAULTS: readonly Permission[] = [
  'catalog.read_admin',
  'outlets.read',
  'inventory.read',
  'orders.read',
  'orders.prepare',
  'orders.view_customer_contact',
  'payments.read',
];

const RIDER_DEFAULTS: readonly Permission[] = [
  'outlets.read',
  'orders.read',
  'orders.view_customer_contact',
  'delivery.update_status',
  'delivery.record_attempt',
  'cod.record_collection',
];

export const ROLE_DEFAULTS: Record<StaffRole, readonly Permission[]> = {
  SUPER_ADMIN: PERMISSIONS,
  OUTLET_MANAGER: MANAGER_DEFAULTS,
  OUTLET_STAFF: STAFF_DEFAULTS,
  DELIVERY_STAFF: RIDER_DEFAULTS,
};

/** Optional grants (⚙) each outlet role may receive on top of its defaults. */
export const ROLE_OPTIONAL: Record<OutletRole, readonly Permission[]> = {
  OUTLET_MANAGER: ['staff.manage_outlet', 'delivery.outlet_rules_manage', 'orders.export_csv'],
  OUTLET_STAFF: [
    'inventory.receive',
    'inventory.adjust',
    'inventory.count',
    'inventory.transfer_receive',
    'orders.confirm',
    'orders.reject',
    'orders.reschedule',
    'delivery.assign',
  ],
  DELIVERY_STAFF: ['delivery.upload_proof'],
};

/** Roles that must complete TOTP MFA before any staff route. */
export const MFA_REQUIRED_ROLES: ReadonlySet<StaffRole> = new Set(['SUPER_ADMIN', 'OUTLET_MANAGER']);

export class PermissionGrantError extends Error {
  constructor(readonly role: OutletRole, readonly permission: string) {
    super(`Permission ${permission} cannot be granted to role ${role}`);
    this.name = 'PermissionGrantError';
  }
}

/** Validates extra grants against the role ceiling and returns the effective permission set. */
export function effectivePermissions(role: StaffRole, extra: readonly string[] = []): ReadonlySet<Permission> {
  if (role === 'SUPER_ADMIN') return new Set(PERMISSIONS);
  const optional = ROLE_OPTIONAL[role];
  for (const p of extra) {
    if (!(optional as readonly string[]).includes(p)) throw new PermissionGrantError(role, p);
  }
  return new Set<Permission>([...ROLE_DEFAULTS[role], ...(extra as Permission[])]);
}
