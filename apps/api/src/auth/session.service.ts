import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Clock } from '../common/clock.js';
import { randomToken, sha256Hex, newId } from '../common/crypto.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import type { Principal } from '../access/principal.js';

export const CUSTOMER_COOKIE = 'dw_sid';
export const STAFF_COOKIE = 'dw_admin_sid';

/** Session lifetimes: customers 30 days (7 idle); staff 12 hours (30 minutes idle). */
const POLICY = {
  CUSTOMER: { absoluteMs: 30 * 86_400_000, idleMs: 7 * 86_400_000 },
  STAFF: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
} as const;

/** Only write last_seen_at when it is this stale, to avoid a write per request. */
const TOUCH_AFTER_MS = 60_000;

@Injectable()
export class SessionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieSecure(): boolean {
    return this.env.NODE_ENV === 'production' || this.env.NODE_ENV === 'staging';
  }

  async create(
    userId: string,
    kind: 'CUSTOMER' | 'STAFF',
    req: Request,
    res: Response,
    opts: { mfaVerified?: boolean } = {},
    tx: Tx = this.prisma,
  ): Promise<string> {
    const token = randomToken();
    const policy = kind === 'CUSTOMER' ? POLICY.CUSTOMER : POLICY.STAFF;
    const now = this.clock.now();
    const id = newId();
    await tx.session.create({
      data: {
        id,
        userId,
        tokenHash: sha256Hex(token),
        kind,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent')?.slice(0, 512) ?? null,
        mfaVerified: opts.mfaVerified ?? false,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + policy.absoluteMs),
      },
    });
    res.cookie(kind === 'CUSTOMER' ? CUSTOMER_COOKIE : STAFF_COOKIE, token, {
      httpOnly: true,
      secure: this.cookieSecure(),
      sameSite: kind === 'CUSTOMER' ? 'lax' : 'strict',
      path: '/',
      maxAge: policy.absoluteMs,
    });
    return id;
  }

  /** Resolves the session cookie to a principal, enforcing expiry, idle timeout and account status. */
  /**
   * `audience` matters when one browser holds both cookies (a staff member who
   * also shops): storefront requests must act as the customer, admin requests
   * as staff. CUSTOMER looks only at the customer cookie.
   */
  async resolve(req: Request, audience: 'CUSTOMER' | 'STAFF' = 'STAFF'): Promise<Principal | null> {
    const cookies = (req.cookies ?? {}) as Record<string, string | undefined>;
    const staffToken = audience === 'STAFF' ? cookies[STAFF_COOKIE] : undefined;
    const customerToken = cookies[CUSTOMER_COOKIE];
    const token = staffToken ?? customerToken;
    if (!token || token.length > 128) return null;

    const now = this.clock.now();
    const session = await this.prisma.session.findUnique({ where: { tokenHash: sha256Hex(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    if (session.kind !== (staffToken ? 'STAFF' : 'CUSTOMER')) return null;
    if (session.user.status !== 'ACTIVE') return null;

    let principal: Principal;
    if (session.kind === 'CUSTOMER') {
      if (now.getTime() - session.lastSeenAt.getTime() > POLICY.CUSTOMER.idleMs) return null;
      principal = { kind: 'CUSTOMER', userId: session.userId, sessionId: session.id };
    } else {
      if (!session.user.staffRole) return null; // staff session for an account that lost its role
      if (now.getTime() - session.lastSeenAt.getTime() > POLICY.STAFF.idleMs) return null;
      principal = {
        kind: 'STAFF',
        userId: session.userId,
        sessionId: session.id,
        role: session.user.staffRole,
        mfaEnabled: session.user.mfaEnabled,
        mfaVerified: session.mfaVerified,
      };
    }

    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    return principal;
  }

  async markMfaVerified(sessionId: string, tx: Tx = this.prisma): Promise<void> {
    await tx.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  /** Revoke every session of a user (role change, suspension, password reset). */
  async revokeAllForUser(userId: string, tx: Tx = this.prisma): Promise<void> {
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
  }

  clearCookies(res: Response, kind?: 'CUSTOMER' | 'STAFF'): void {
    if (kind !== 'STAFF') res.clearCookie(CUSTOMER_COOKIE, { path: '/' });
    if (kind !== 'CUSTOMER') res.clearCookie(STAFF_COOKIE, { path: '/' });
  }
}
