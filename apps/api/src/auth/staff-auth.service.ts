import { Inject, Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import type { Request, Response } from 'express';
import { MFA_REQUIRED_ROLES, type StaffRole } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { DataCipher, hmacHex, newId, randomToken, safeEqualHex } from '../common/crypto.js';
import { AppError } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { StaffPrincipal } from '../access/principal.js';
import { SessionService } from './session.service.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

export const LOGIN_POLICY = { maxFailures: 5, windowMs: 15 * 60_000 } as const;
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65_536, timeCost: 3, parallelism: 1 } as const;
export const MIN_PASSWORD_LENGTH = 12;

// Equalises timing for unknown accounts so login does not reveal which accounts exist.
const DUMMY_HASH = argon2.hash('dudhwala-timing-equaliser', ARGON2_OPTIONS);

@Injectable()
export class StaffAuthService {
  private readonly cipher: DataCipher;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {
    this.cipher = new DataCipher(env.DATA_ENCRYPTION_KEY, env.DATA_ENCRYPTION_KEY_ID);
  }

  static hashPassword(password: string): Promise<string> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new AppError('VALIDATION_FAILED', `Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  private async roleOf(userId: string): Promise<StaffRole | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } }, outletAssignment: { include: { role: true } } },
    });
    if (!u) return null;
    if (u.roles.some((r) => r.role.code === 'SUPER_ADMIN')) return 'SUPER_ADMIN';
    return u.outletAssignment?.active ? (u.outletAssignment.role.code as StaffRole) : null;
  }

  async login(login: string, password: string, req: Request, res: Response): Promise<{ mfaRequired: boolean; mfaEnrolled: boolean }> {
    await this.limits.hit(LIMITS.staffLoginPerIp, req.ip);
    const now = this.clock.now();
    const user = await this.prisma.user.findFirst({ where: { kind: 'STAFF', OR: [{ email: login }, { phone: login }] } });
    if (!user?.passwordHash) {
      await argon2.verify(await DUMMY_HASH, password);
      throw new AppError('UNAUTHENTICATED', 'Invalid login or password');
    }

    const failures = await this.prisma.auditLog.count({
      where: { actorUserId: user.id, action: 'auth.staff_login_failed', createdAt: { gt: new Date(now.getTime() - LOGIN_POLICY.windowMs) } },
    });
    if (failures >= LOGIN_POLICY.maxFailures) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later or contact the administrator.', undefined, LOGIN_POLICY.windowMs / 1000);
    }

    const ok = await argon2.verify(user.passwordHash, password);
    const role = ok ? await this.roleOf(user.id) : null;
    if (!ok || user.status !== 'ACTIVE' || !role) {
      await this.audit.record({ action: 'auth.staff_login_failed', entityType: 'user', entityId: user.id }, { userId: user.id, actorRole: 'STAFF' }, req);
      throw new AppError('UNAUTHENTICATED', 'Invalid login or password');
    }

    const mfaRequired = MFA_REQUIRED_ROLES.has(role) || user.mfaEnabled;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      await this.sessions.create(user.id, 'STAFF', req, res, { role, mfaVerified: !mfaRequired }, tx);
      await this.audit.record({ action: 'auth.staff_login', entityType: 'user', entityId: user.id }, { userId: user.id, actorRole: role }, req, tx);
    });
    return { mfaRequired, mfaEnrolled: user.mfaEnabled };
  }

  /** Self-service password change: current password required; every other session ends. */
  async changePassword(p: StaffPrincipal, current: string, next: string, req: Request): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (!user.passwordHash || !(await argon2.verify(user.passwordHash, current))) throw new AppError('VALIDATION_FAILED', 'Current password is incorrect');
    if (current === next) throw new AppError('VALIDATION_FAILED', 'Choose a different password');
    const passwordHash = await StaffAuthService.hashPassword(next);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({ where: { userId: user.id, revokedAt: null, id: { not: p.sessionId } }, data: { revokedAt: this.clock.now() } });
      await this.audit.record({ action: 'auth.password_change', entityType: 'user', entityId: user.id }, { principal: p }, req, tx);
    });
  }

  /** Starts TOTP enrolment; returns the secret once for the authenticator app. */
  async beginEnrollment(p: StaffPrincipal, req: Request): Promise<{ otpauthUri: string; secret: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (user.mfaEnabled) throw new AppError('CONFLICT', 'Two-factor is already enabled; ask a Super Admin to reset it');
    const secret = generateTotpSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaTotpSecretEnc: this.cipher.encrypt(secret) } });
    await this.audit.record({ action: 'auth.mfa_enroll_started', entityType: 'user', entityId: user.id }, { principal: p }, req);
    return { otpauthUri: otpauthUri(secret, user.email ?? user.phone ?? user.id), secret };
  }

  /** Confirms enrolment with a first code; returns one-time recovery codes. */
  async confirmEnrollment(p: StaffPrincipal, code: string, req: Request): Promise<{ recoveryCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (user.mfaEnabled || !user.mfaTotpSecretEnc) throw new AppError('CONFLICT', 'No enrolment in progress');
    await this.checkCode(user.id, this.cipher.decrypt(user.mfaTotpSecretEnc), code);
    const recoveryCodes = Array.from({ length: 10 }, () => randomToken(6));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((c) => ({ id: newId(), userId: user.id, codeHash: hmacHex(this.env.OTP_HMAC_KEY, c) })),
      });
      await this.sessions.markMfaVerified(p.sessionId, tx);
      await this.audit.record({ action: 'auth.mfa_enrolled', entityType: 'user', entityId: user.id }, { principal: p }, req, tx);
    });
    return { recoveryCodes };
  }

  /** Verifies a TOTP or recovery code for the current session. */
  async verifyMfa(p: StaffPrincipal, code: string, req: Request): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    if (!user.mfaEnabled || !user.mfaTotpSecretEnc) throw new AppError('CONFLICT', 'Two-factor is not enrolled');
    if (/^\d{6}$/.test(code)) {
      await this.checkCode(user.id, this.cipher.decrypt(user.mfaTotpSecretEnc), code);
    } else {
      const codes = await this.prisma.mfaRecoveryCode.findMany({ where: { userId: user.id, usedAt: null } });
      const hash = hmacHex(this.env.OTP_HMAC_KEY, code);
      const match = codes.find((c) => safeEqualHex(c.codeHash, hash));
      if (!match) throw new AppError('OTP_INVALID', 'Incorrect code');
      const used = await this.prisma.mfaRecoveryCode.updateMany({ where: { id: match.id, usedAt: null }, data: { usedAt: this.clock.now() } });
      if (used.count === 0) throw new AppError('OTP_INVALID', 'Incorrect code');
    }
    await this.sessions.markMfaVerified(p.sessionId);
    await this.audit.record({ action: 'auth.mfa_verified', entityType: 'user', entityId: user.id }, { principal: p }, req);
  }

  /**
   * Verifies a TOTP code and records its time step with a conditional update,
   * so the same (or an earlier) code is rejected on every API instance.
   */
  private async checkCode(userId: string, secret: string, code: string): Promise<void> {
    const step = verifyTotp(secret, code, this.clock.now());
    if (step === null) throw new AppError('OTP_INVALID', 'Incorrect code');
    const claimed = await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
      data: { mfaLastStep: step },
    });
    if (claimed.count === 0) throw new AppError('OTP_INVALID', 'Incorrect code');
  }
}
