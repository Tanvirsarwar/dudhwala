import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { ENV, type Env } from '../config/env.js';

export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    // The pg adapter sends timestamps without a zone; pin the session to UTC so they are stored
    // correctly whatever the server's default TimeZone is (found in M7: a server set to
    // Asia/Dhaka stored app-written times 6 h off from DB-generated defaults).
    super({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL, options: '-c TimeZone=UTC' }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
