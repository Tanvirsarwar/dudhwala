/**
 * Creates a staff account: an ADMIN (full access, two-factor required) or a MANAGER (read-only).
 *
 *   STAFF_PASSWORD='…' node dist/cli/create-staff.js --role admin --email owner@example.com --name "Owner Name"
 *
 * The password comes from an environment variable so it never lands in shell history or process listings.
 * An ADMIN must enrol two-factor authentication on first login before any admin action is allowed.
 * Refuses to touch an existing email.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StaffAuthService } from '../auth/staff-auth.service.js';
import { newId } from '../common/crypto.js';
import type { StaffRole } from '../access/principal.js';

export async function createStaff(prisma: PrismaService, input: { role: StaffRole; email: string; name: string; password: string }): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email');
  const passwordHash = await StaffAuthService.hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) throw new Error('A user with this email already exists');
    const user = await tx.user.create({ data: { id: newId(), kind: 'STAFF', staffRole: input.role, email, fullName: input.name.trim(), passwordHash } });
    await tx.auditLog.create({ data: { id: newId(), actorRole: 'CLI', action: 'staff.created_cli', entityType: 'user', entityId: user.id, after: { email, role: input.role } } });
    return user.id;
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { role: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } } });
  const password = process.env.STAFF_PASSWORD;
  const role = values.role?.toUpperCase();
  if ((role !== 'ADMIN' && role !== 'MANAGER') || !values.email || !values.name || !password) {
    console.error('Usage: STAFF_PASSWORD=… create-staff --role admin|manager --email <email> --name <name>');
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
    const id = await createStaff(prisma, { role, email: values.email, name: values.name, password });
    console.log(`${role} created (${id}).${role === 'ADMIN' ? ' Log in at the admin site and enrol two-factor authentication.' : ''}`);
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
