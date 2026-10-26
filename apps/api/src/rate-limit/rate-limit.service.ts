import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../common/clock.js';
import { AppError } from '../common/errors.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Limit {
  /** Bucket name, e.g. "staff-login:ip". */
  name: string;
  max: number;
  windowMs: number;
}

/** Limits from API_SPECIFICATION §7 that are counted per IP. */
export const LIMITS = {
  staffLoginPerIp: { name: 'staff-login:ip', max: 30, windowMs: 3_600_000 },
  otpVerifyPerIp: { name: 'otp-verify:ip', max: 30, windowMs: 3_600_000 },
  couponPerIp: { name: 'coupon:ip', max: 10, windowMs: 10 * 60_000 },
  checkoutPerCustomer: { name: 'checkout:user', max: 30, windowMs: 10 * 60_000 },
  paymentPerOrder: { name: 'payment:order', max: 10, windowMs: 10 * 60_000 },
} as const satisfies Record<string, Limit>;

/**
 * Fixed-window counter in PostgreSQL so all API instances share one count.
 * One atomic upsert per hit; no read-then-write race.
 */
@Injectable()
export class RateLimitService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
  ) {}

  /** Counts a hit and throws RATE_LIMITED once the window's limit is exceeded. */
  async hit(limit: Limit, subject: string | undefined | null): Promise<void> {
    if (!subject) return;
    const now = this.clock.now().getTime();
    const windowStart = new Date(now - (now % limit.windowMs));
    const key = `${limit.name}:${subject}`.slice(0, 160);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limit_bucket (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_bucket.count + 1
      RETURNING count`;
    const count = rows[0]?.count ?? 0;
    if (count > limit.max) {
      const retryAfterSec = Math.ceil((windowStart.getTime() + limit.windowMs - now) / 1000);
      throw new AppError('RATE_LIMITED', 'Too many requests. Try again later.', undefined, retryAfterSec);
    }
  }

  /** Deletes windows older than `olderThanMs` (run by the cleanup job). */
  async purge(olderThanMs: number): Promise<number> {
    const cutoff = new Date(this.clock.now().getTime() - olderThanMs);
    const r = await this.prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: cutoff } } });
    return r.count;
  }
}
