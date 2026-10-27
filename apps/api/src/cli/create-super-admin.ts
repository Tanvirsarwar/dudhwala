/**
 * Creates the first Super Admin (or another one) and seeds system roles.
 *
 *   SUPER_ADMIN_PASSWORD='…' pnpm --filter @dudhwala/api cli:create-super-admin -- --email owner@example.com --name "Owner Name"
 *
 * The password comes from an environment variable so it never lands in shell
 * history or process listings. The new admin must enrol two-factor
 * authentication on first login before any admin action is allowed.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffAuthService } from '../auth/staff-auth.service.js';
import { newId } from '../common/crypto.js';
import { seedSystem } from '../seed/system-seed.js';

export async function createSuperAdmin(prisma: PrismaService, input: { email: string; name: string; password: string }): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  const passwordHash = await StaffAuthService.hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    await seedSystem(tx);
    if (await tx.user.findUnique({ where: { email } })) throw new Error('A user with this email already exists');
    const role = await tx.role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' } });
    const user = await tx.user.create({ data: { id: newId(), kind: 'STAFF', email, fullName: input.name.trim(), passwordHash } });
    await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await tx.auditLog.create({
      data: { id: newId(), actorRole: 'CLI', action: 'staff.super_admin_created', entityType: 'user', entityId: user.id, after: { email } },
    });
    return user.id;
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' } } });
  const password = process.env.SUPER_ADMIN_PASSWORD;
  if (!values.email || !values.name || !password) {
    console.error('Usage: SUPER_ADMIN_PASSWORD=… create-super-admin --email <email> --name <name>');
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  // The CLI only needs the database connection, not the full HTTP configuration.
  const prisma = new PrismaService({ DATABASE_URL: databaseUrl, DATABASE_CA_CERT: process.env.DATABASE_CA_CERT ?? '' } as Env);
  try {
    const id = await createSuperAdmin(prisma, { email: values.email, name: values.name, password });
    console.log(`Super Admin created (${id}). Log in at the admin site and enrol two-factor authentication.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
