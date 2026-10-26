import { Inject, Injectable, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { Clock } from '../common/clock.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { JobsService } from './jobs.service.js';

export const MAINTENANCE_JOB = 'maintenance.cleanup';
const DAY = 86_400_000;

/**
 * Removes expired short-lived security records. Keeps 30 days of expired
 * sessions/OTP challenges for incident investigation, then deletes them
 * (data minimisation, SECURITY_REVIEW §6). Re-schedules itself hourly.
 */
@Injectable()
export class MaintenanceJob implements OnModuleInit, OnApplicationBootstrap {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.jobs.register(MAINTENANCE_JOB, async () => {
      await this.cleanup();
      await this.scheduleNext();
    });
  }

  /** Ensures one pending maintenance job exists (idempotent; safe on every boot). */
  async scheduleNext(): Promise<void> {
    const pending = await this.prisma.job.count({ where: { type: MAINTENANCE_JOB, status: 'PENDING' } });
    if (pending === 0) await this.jobs.enqueue(MAINTENANCE_JOB, {}, { runAt: new Date(this.clock.now().getTime() + 3_600_000) });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV !== 'test') await this.scheduleNext();
  }

  async cleanup(): Promise<{ sessions: number; otps: number; idempotency: number; rateLimits: number; jobs: number }> {
    const now = this.clock.now().getTime();
    const monthAgo = new Date(now - 30 * DAY);
    const [sessions, otps, idempotency, jobs] = await Promise.all([
      this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: monthAgo } }, { revokedAt: { lt: monthAgo } }] } }),
      this.prisma.otpChallenge.deleteMany({ where: { expiresAt: { lt: monthAgo } } }),
      this.prisma.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now - DAY) } } }),
      this.prisma.job.deleteMany({ where: { status: 'DONE', createdAt: { lt: new Date(now - 7 * DAY) } } }),
    ]);
    const rateLimits = await this.limits.purge(2 * DAY);
    return { sessions: sessions.count, otps: otps.count, idempotency: idempotency.count, rateLimits, jobs: jobs.count };
  }
}
