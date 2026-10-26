import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { tryNormalizeBdMobile } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { hmacHex, newId, numericCode, safeEqualHex } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SessionService } from './session.service.js';
import { SmsSender } from './sms.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';

/** Limits from API_SPECIFICATION §7 and SECURITY_REVIEW §2. */
export const OTP_POLICY = {
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendAfterMs: 60_000,
  perPhonePerHour: 5,
  perIpPerHour: 20,
} as const;

@Injectable()
export class OtpService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(SmsSender) private readonly sms: SmsSender,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private hash(challengeId: string, code: string): string {
    return hmacHex(this.env.OTP_HMAC_KEY, `${challengeId}:${code}`);
  }

  async request(rawPhone: string, req: Request): Promise<{ challengeId: string; expiresInSec: number; resendAfterSec: number }> {
    const phone = tryNormalizeBdMobile(rawPhone);
    if (!phone) throw new AppError('VALIDATION_FAILED', 'Invalid Bangladeshi mobile number');
    const now = this.clock.now();
    const hourAgo = new Date(now.getTime() - 3_600_000);
    const [last, phoneCount, ipCount] = await Promise.all([
      this.prisma.otpChallenge.findFirst({ where: { phone }, orderBy: { createdAt: 'desc' } }),
      this.prisma.otpChallenge.count({ where: { phone, createdAt: { gt: hourAgo } } }),
      req.ip ? this.prisma.otpChallenge.count({ where: { ip: req.ip, createdAt: { gt: hourAgo } } }) : Promise.resolve(0),
    ]);
    if (last && now.getTime() - last.createdAt.getTime() < OTP_POLICY.resendAfterMs) {
      const wait = Math.ceil((OTP_POLICY.resendAfterMs - (now.getTime() - last.createdAt.getTime())) / 1000);
      throw new AppError('RATE_LIMITED', 'Please wait before requesting another code', undefined, wait);
    }
    if (phoneCount >= OTP_POLICY.perPhonePerHour || ipCount >= OTP_POLICY.perIpPerHour) {
      throw new AppError('RATE_LIMITED', 'Too many codes requested. Try again later.', undefined, 3600);
    }

    const id = newId();
    const code = numericCode(6);
    await this.prisma.otpChallenge.create({
      data: {
        id,
        phone,
        purpose: 'LOGIN',
        codeHash: this.hash(id, code),
        maxAttempts: OTP_POLICY.maxAttempts,
        expiresAt: new Date(now.getTime() + OTP_POLICY.ttlMs),
        ip: req.ip ?? null,
        createdAt: now,
      },
    });
    await this.sms.send(phone, `দুধওয়ালা: আপনার লগইন কোড ${code}। ৫ মিনিটের মধ্যে ব্যবহার করুন। কাউকে এই কোড দেবেন না।`);
    return { challengeId: id, expiresInSec: OTP_POLICY.ttlMs / 1000, resendAfterSec: OTP_POLICY.resendAfterMs / 1000 };
  }

  /** Verifies the code, creates or finds the customer, and starts a customer session. */
  async verify(challengeId: string, code: string, req: Request, res: Response): Promise<{ userId: string; isNew: boolean }> {
    await this.limits.hit(LIMITS.otpVerifyPerIp, req.ip);
    const now = this.clock.now();
    // Count the attempt atomically before comparing, so parallel guesses cannot exceed the limit.
    const bumped = await this.prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: OTP_POLICY.maxAttempts } },
      data: { attempts: { increment: 1 } },
    });
    if (bumped.count === 0) throw new AppError('OTP_EXPIRED', 'Code expired or too many attempts. Request a new code.');
    const ch = await this.prisma.otpChallenge.findUniqueOrThrow({ where: { id: challengeId } });
    if (!/^\d{6}$/.test(code) || !safeEqualHex(ch.codeHash, this.hash(ch.id, code))) {
      throw new AppError('OTP_INVALID', 'Incorrect code');
    }

    return this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: now } });
      if (consumed.count === 0) throw new AppError('OTP_EXPIRED', 'Code already used');

      let user = await tx.user.findUnique({ where: { phone: ch.phone } });
      const isNew = !user;
      if (user && user.kind !== 'CUSTOMER') throw new AppError('FORBIDDEN', 'Use the staff login for this account');
      if (user && user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account is not active');
      if (!user) {
        user = await tx.user.create({
          data: { id: newId(), phone: ch.phone, kind: 'CUSTOMER', phoneVerifiedAt: now, lastLoginAt: now },
        });
        const role = await tx.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      } else {
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now, phoneVerifiedAt: user.phoneVerifiedAt ?? now } });
      }
      await this.sessions.create(user.id, 'CUSTOMER', req, res, {}, tx);
      if (isNew) await this.audit.record({ action: 'customer.registered', entityType: 'user', entityId: user.id }, { userId: user.id, actorRole: 'CUSTOMER' }, req, tx);
      return { userId: user.id, isNew };
    });
  }
}
