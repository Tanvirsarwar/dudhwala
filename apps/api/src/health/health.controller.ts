import { Controller, Get, Headers, Inject } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../access/decorators.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ENV, type Env } from '../config/env.js';
import { notFound } from '../common/errors.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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

  /**
   * Deployment check for serverless hosts: proves the native modules load and that a row-locking transaction works on this
   * instance's single pooled connection. Off (404) unless HEALTH_DIAG_TOKEN is set; otherwise needs `Authorization: Bearer <token>`.
   * Returns pass/fail and versions only — never settings, rows or secrets.
   */
  @Get('runtime')
  @Public()
  async runtime(@Headers('authorization') auth: string | undefined) {
    const want = this.env.HEALTH_DIAG_TOKEN;
    if (!want) throw notFound();
    const got = Buffer.from(auth?.replace(/^Bearer /, '') ?? '');
    const exp = Buffer.from(want);
    if (got.length !== exp.length || !timingSafeEqual(got, exp)) throw new AppError('UNAUTHENTICATED', 'Invalid token');
    const check = async (fn: () => Promise<unknown>) => {
      try {
        return { ok: true, detail: await fn() };
      } catch (e) {
        return { ok: false, detail: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
      }
    };
    return {
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      poolMax: this.env.DATABASE_POOL_MAX,
      argon2: await check(async () => {
        const { default: argon2 } = await import('argon2');
        const h = await argon2.hash('probe-password', { type: argon2.argon2id, memoryCost: 1024, timeCost: 1 });
        return h.startsWith('$argon2id$') && (await argon2.verify(h, 'probe-password'));
      }),
      sharp: await check(async () => {
        const { default: sharp } = await import('sharp');
        const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#fff' } }).png().toBuffer();
        return (await sharp(png).webp().toBuffer()).subarray(8, 12).toString() === 'WEBP';
      }),
      database: await check(async () => {
        // an interactive transaction with a row lock, using only `tx`: must not need a second connection
        await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT key FROM setting LIMIT 1 FOR UPDATE`;
          await tx.$queryRaw`SELECT 1`;
        });
        const r = await this.prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`;
        return { transaction: true, sessionTimeZone: r[0]?.tz };
      }),
    };
  }
}
