import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';

/**
 * Pool settings for the pg adapter. With DATABASE_CA_CERT the server certificate is verified against that CA
 * (verify-full: chain and host name). `sslmode`/`ssl*` URL parameters are removed first because pg lets them
 * override the explicit `ssl` option.
 */
export function poolConfig(env: Pick<Env, 'DATABASE_URL'> & { DATABASE_CA_CERT?: string; DATABASE_POOL_MAX?: number }) {
  // The pg adapter sends timestamps without a zone; pin the session to UTC so they are stored
  // correctly whatever the server's default TimeZone is (found in M7: a server set to
  // Asia/Dhaka stored app-written times 6 h off from DB-generated defaults).
  const base = { options: '-c TimeZone=UTC', ...(env.DATABASE_POOL_MAX ? { max: env.DATABASE_POOL_MAX } : {}) };
  if (!env.DATABASE_CA_CERT) return { connectionString: env.DATABASE_URL, ...base };
  const url = new URL(env.DATABASE_URL);
  for (const k of [...url.searchParams.keys()]) if (/^ssl/i.test(k)) url.searchParams.delete(k);
  // Dashboards often store multi-line values with literal \n sequences.
  const ca = env.DATABASE_CA_CERT.replace(/\\n/g, '\n');
  return { connectionString: url.toString(), ...base, ssl: { ca, rejectUnauthorized: true } };
}

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ adapter: new PrismaPg(poolConfig(env)) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
