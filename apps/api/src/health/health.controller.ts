import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../access/decorators.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Liveness: the process is up. Touches nothing else. */
  @Get('live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database reachable and migrated (the V2 tables exist). Exposes no versions, hosts or secrets. */
  @Get('ready')
  @Public()
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM setting LIMIT 1`;
      await this.prisma.$queryRaw`SELECT 1 FROM "order" LIMIT 1`;
      return { status: 'ok' };
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'Not ready');
    }
  }
}
