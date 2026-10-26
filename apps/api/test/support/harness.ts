import type { NestExpressApplication } from '@nestjs/platform-express';
import argon2 from 'argon2';
import request from 'supertest';

import { loadEnv } from '../../src/config/env.js';
import { createApp } from '../../src/bootstrap.js';
import { Clock } from '../../src/common/clock.js';
import { newId } from '../../src/common/crypto.js';
import { SmsSender } from '../../src/auth/sms.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { seedSystem } from '../../src/seed/system-seed.js';
import { totpAt, generateTotpSecret } from '../../src/auth/totp.js';
import { DataCipher } from '../../src/common/crypto.js';
import type { HttpFetch } from '../../src/payments/sslcommerz-gateway.js';

export class FakeClock extends Clock {
  constructor(public t = new Date('2026-11-01T04:00:00Z')) {
    super();
  }
  now(): Date {
    return new Date(this.t);
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

export class CapturingSms extends SmsSender {
  sent: { to: string; text: string }[] = [];
  async send(to: string, text: string) {
    this.sent.push({ to, text });
    return { providerMessageId: `test-${this.sent.length}` };
  }
  lastCode(): string {
    const m = /(\d{6})/.exec(this.sent.at(-1)?.text ?? '');
    if (!m?.[1]) throw new Error('no code sent');
    return m[1];
  }
}

const KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_RAW_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  ADMIN_ORIGIN: 'http://localhost:3001',
  API_PUBLIC_URL: 'http://localhost:4000',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
  SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  OTP_HMAC_KEY: 'test-otp-hmac-key-0123456789abcdef',
  DATA_ENCRYPTION_KEY: KEY,
};
export const TEST_ENV = loadEnv(TEST_RAW_ENV);
const cipher = new DataCipher(KEY, 'k1');
// Cheap hashing for fixtures only; production uses ARGON2_OPTIONS.
const FIXTURE_ARGON = { type: argon2.argon2id, memoryCost: 1024, timeCost: 1 } as const;

export interface Harness {
  app: NestExpressApplication;
  prisma: PrismaService;
  clock: FakeClock;
  sms: CapturingSms;
  close: () => Promise<void>;
}

export async function startHarness(opts: { env?: Partial<Record<string, string>>; httpFetch?: HttpFetch } = {}): Promise<Harness> {
  const clock = new FakeClock();
  const sms = new CapturingSms();
  const env = opts.env ? loadEnv({ ...TEST_RAW_ENV, ...opts.env }) : TEST_ENV;
  const app = await createApp(env, { clock, sms, ...(opts.httpFetch ? { httpFetch: opts.httpFetch } : {}) });
  await app.init();
  const prisma = app.get(PrismaService);
  await resetDb(prisma);
  return { app, prisma, clock, sms, close: () => app.close() };
}

export async function resetDb(prisma: PrismaService): Promise<void> {
  // Append-only triggers block DELETE; TRUNCATE bypasses row triggers (test databases only).
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`); // eslint-disable-line no-restricted-properties -- fixed table names from pg_tables
  await prisma.$transaction((tx) => seedSystem(tx));
}

/** Agent with cookie jar + CSRF token wired in, emulating a browser at `origin`. */
export async function browser(app: NestExpressApplication, origin = TEST_ENV.ADMIN_ORIGIN) {
  const agent = request.agent(app.getHttpServer());
  const { body } = await agent.get('/v1/auth/csrf').expect(200);
  const token = (body as { csrfToken: string }).csrfToken;
  agent.set('x-csrf-token', token).set('origin', origin);
  return agent;
}

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeOutlet(prisma: PrismaService, code = `T${uniq()}`.toUpperCase().slice(0, 16)) {
  return prisma.outlet.create({ data: { id: newId(), code, nameBn: `আউটলেট ${code}`, addressLine: 'TEST address', status: 'ACTIVE' } });
}

export async function makeVariant(prisma: PrismaService) {
  const cat = await prisma.category.create({ data: { id: newId(), slug: `test-${uniq()}`, nameBn: 'টেস্ট' } });
  const product = await prisma.product.create({ data: { id: newId(), categoryId: cat.id, slug: `p-${uniq()}`, nameBn: 'টেস্ট দুধ', status: 'ACTIVE' } });
  return prisma.productVariant.create({
    data: { id: newId(), productId: product.id, sku: `SKU-${uniq()}`, labelBn: '১ লিটার', packSize: 1, packUnit: 'L', pricePoisha: 9000, status: 'ACTIVE' },
  });
}

export const PASSWORD = 'correct-horse-battery';

export async function makeStaff(
  prisma: PrismaService,
  role: 'SUPER_ADMIN' | 'OUTLET_MANAGER' | 'OUTLET_STAFF' | 'DELIVERY_STAFF',
  outletId: string | null,
  opts: { extraPermissions?: string[]; withMfa?: boolean } = {},
) {
  const email = `${role.toLowerCase()}-${uniq()}@test.local`;
  const secret = generateTotpSecret();
  const withMfa = opts.withMfa ?? (role === 'SUPER_ADMIN' || role === 'OUTLET_MANAGER');
  const user = await prisma.user.create({
    data: {
      id: newId(),
      kind: 'STAFF',
      email,
      fullName: role,
      passwordHash: await argon2.hash(PASSWORD, FIXTURE_ARGON),
      mfaEnabled: withMfa,
      mfaTotpSecretEnc: withMfa ? cipher.encrypt(secret) : null,
    },
  });
  const r = await prisma.role.findUniqueOrThrow({ where: { code: role } });
  if (role === 'SUPER_ADMIN') {
    await prisma.userRole.create({ data: { userId: user.id, roleId: r.id } });
  } else {
    if (!outletId) throw new Error('outlet role needs outletId');
    await prisma.outletStaff.create({
      data: { id: newId(), userId: user.id, outletId, roleId: r.id, extraPermissions: opts.extraPermissions ?? [], grantedById: user.id },
    });
  }
  return { user, email, secret };
}

/** Logs a staff member in (and completes MFA when enrolled). */
export async function loginStaff(h: Harness, staff: { email: string; secret: string; user: { mfaEnabled: boolean } }) {
  const agent = await browser(h.app);
  const res = await agent.post('/v1/auth/staff/login').send({ login: staff.email, password: PASSWORD }).expect(200);
  if ((res.body as { mfaRequired: boolean }).mfaRequired && staff.user.mfaEnabled) {
    h.clock.advance(31_000); // each login uses a fresh TOTP step (replay guard)
    await agent.post('/v1/auth/staff/mfa').send({ code: totpAt(staff.secret, h.clock.now()) }).expect(204);
  }
  return agent;
}
