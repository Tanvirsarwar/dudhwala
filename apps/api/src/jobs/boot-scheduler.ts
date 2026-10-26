import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { JobsService } from './jobs.service.js';
import { SLOT_GENERATION_JOB } from '../delivery/delivery-config.service.js';

/** Ensures recurring jobs exist after every deploy (idempotent across instances). */
@Injectable()
export class BootScheduler implements OnApplicationBootstrap {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.env.NODE_ENV === 'test') return;
    await this.payments.scheduleJobs();
    if ((await this.prisma.job.count({ where: { type: SLOT_GENERATION_JOB, status: 'PENDING' } })) === 0) await this.jobs.enqueue(SLOT_GENERATION_JOB, {});
  }
}
