import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';

const DAY = 86_400_000;

/**
 * In-process housekeeping (no queue needed at this scale; every task is idempotent and safe if two instances run it):
 *  - every hour: delete expired short-lived security records (sessions/OTP after 30 days, idempotency records after 1 day,
 *    rate-limit windows after 2 days, expired anonymous carts)
 * Disabled when NODE_ENV=test (tests call the methods directly).
 */
@Injectable()
export class MaintenanceJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Maintenance');
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') return;
    const run = (name: string, fn: () => Promise<unknown>) => () => void fn().catch((e: unknown) => this.logger.error(`${name} failed: ${e instanceof Error ? e.message : String(e)}`));
    this.timers.push(setInterval(run('cleanup', () => this.cleanup()), 3_600_000).unref());
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearInterval(t);
  }

  async cleanup(): Promise<{ sessions: number; otps: number; idempotency: number; rateLimits: number; carts: number }> {
    const now = this.clock.now().getTime();
    const monthAgo = new Date(now - 30 * DAY);
    const [sessions, otps, idempotency, carts] = await Promise.all([
      this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: monthAgo } }, { revokedAt: { lt: monthAgo } }] } }),
      this.prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: monthAgo } } }),
      this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now - DAY) } } }),
      this.prisma.cart.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
    ]);
    const rateLimits = await this.limits.purge(2 * DAY);
    return { sessions: sessions.count, otps: otps.count, idempotency: idempotency.count, rateLimits, carts: carts.count };
  }
}
