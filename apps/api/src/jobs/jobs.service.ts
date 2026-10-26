import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { Clock } from '../common/clock.js';
import { newId } from '../common/crypto.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export type JobHandler = (payload: Prisma.JsonValue) => Promise<void>;

interface ClaimedJob {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
}

export const JOB_POLICY = {
  pollMs: 2_000,
  batch: 10,
  maxAttempts: 8,
  /** A RUNNING job whose lock is older than this is assumed crashed and retried. */
  staleLockMs: 5 * 60_000,
} as const;

/** Exponential back-off: 30 s, 1 min, 2 min … capped at 1 h. */
export const backoffMs = (attempt: number): number => Math.min(3_600_000, 30_000 * 2 ** Math.max(0, attempt - 1));

/**
 * PostgreSQL-backed job queue (TRD §3: no Redis until needed). Workers on any
 * number of API instances claim jobs with FOR UPDATE SKIP LOCKED, so a job runs
 * on one instance at a time. Enqueue inside a business transaction for
 * outbox semantics: the job exists if and only if the transaction committed.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private readonly handlers = new Map<string, JobHandler>();
  private readonly workerId = `${hostname()}:${process.pid}:${newId().slice(-6)}`;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  register(type: string, handler: JobHandler): void {
    if (this.handlers.has(type)) throw new Error(`Job handler ${type} already registered`);
    this.handlers.set(type, handler);
  }

  async enqueue(type: string, payload: Prisma.InputJsonValue, opts: { runAt?: Date; tx?: Tx } = {}): Promise<string> {
    const id = newId();
    await (opts.tx ?? this.prisma).job.create({ data: { id, type, payload, runAt: opts.runAt ?? this.clock.now() } });
    return id;
  }

  onModuleInit(): void {
    // Tests drive runOnce() explicitly; real processes poll.
    if (this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.runOnce().catch((e: unknown) => this.logger.error(String(e))), JOB_POLICY.pollMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Claims and runs one batch of due jobs. Returns how many were processed. */
  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const now = this.clock.now();
      const staleBefore = new Date(now.getTime() - JOB_POLICY.staleLockMs);
      const jobs = await this.prisma.$queryRaw<ClaimedJob[]>`
        UPDATE job SET status = 'RUNNING', locked_at = ${now}, locked_by = ${this.workerId}, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM job
          WHERE (status = 'PENDING' AND run_at <= ${now}) OR (status = 'RUNNING' AND locked_at < ${staleBefore})
          ORDER BY run_at
          LIMIT ${JOB_POLICY.batch}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, type, payload, attempts`;
      for (const job of jobs) await this.execute(job);
      return jobs.length;
    } finally {
      this.running = false;
    }
  }

  private async execute(job: ClaimedJob): Promise<void> {
    const handler = this.handlers.get(job.type);
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      await handler(job.payload);
      await this.prisma.job.update({ where: { id: job.id }, data: { status: 'DONE', lockedAt: null, lockedBy: null, lastError: null } });
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 1000);
      const failed = job.attempts >= JOB_POLICY.maxAttempts;
      await this.prisma.job.update({
        where: { id: job.id },
        data: {
          status: failed ? 'FAILED' : 'PENDING',
          lastError: message,
          lockedAt: null,
          lockedBy: null,
          runAt: new Date(this.clock.now().getTime() + backoffMs(job.attempts)),
        },
      });
      this.logger.warn(`job ${job.type} ${job.id} attempt ${job.attempts} failed${failed ? ' permanently' : ''}: ${message}`);
    }
  }
}
