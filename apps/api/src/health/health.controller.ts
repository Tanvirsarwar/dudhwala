import { Controller, Get, Inject } from '@nestjs/common';
import { Public } from '../access/decorators.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get('live')
  @Public()
  live() {
    return { status: 'ok' };
  }

  /** Readiness: DB reachable and seeded system roles present. Exposes no versions or secrets. */
  @Get('ready')
  @Public()
  async ready() {
    try {
      const roles = await this.prisma.role.count();
      if (roles < 5) throw new Error('roles not seeded');
      return { status: 'ok' };
    } catch {
      throw new AppError('CONFLICT', 'Not ready');
    }
  }
}
