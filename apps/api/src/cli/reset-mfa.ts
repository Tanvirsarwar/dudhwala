/**
 * Break-glass: clears two-factor for a staff account (e.g. a Super Admin who lost
 * both phone and recovery codes) and ends all their sessions. Needs direct database
 * access, so only people who hold production credentials can run it. Audited.
 *
 *   DATABASE_URL=… node dist/cli/reset-mfa.js --email owner@example.com
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { newId } from '../common/crypto.js';

export async function resetMfa(prisma: PrismaService, email: string): Promise<void> {
  const user = await prisma.user.findFirst({ where: { email: email.trim().toLowerCase(), kind: 'STAFF' } });
  if (!user) throw new Error('No staff account with this email');
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaTotpSecretEnc: null, mfaLastStep: null } });
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.auditLog.create({ data: { id: newId(), actorRole: 'CLI', action: 'staff.mfa_reset_cli', entityType: 'user', entityId: user.id } });
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { email: { type: 'string' } } });
  const url = process.env.DATABASE_URL;
  if (!values.email || !url) {
    console.error('Usage: DATABASE_URL=… reset-mfa --email <email>');
    process.exit(2);
  }
  const prisma = new PrismaService({ DATABASE_URL: url, DATABASE_CA_CERT: process.env.DATABASE_CA_CERT ?? '' } as Env);
  try {
    await resetMfa(prisma, values.email);
    console.log('Two-factor cleared. The person must enrol a new authenticator at the next login.');
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
