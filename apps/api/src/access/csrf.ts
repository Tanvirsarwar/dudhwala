import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors.js';
import { hmacHex, randomToken, safeEqualHex } from '../common/crypto.js';
import { ENV, type Env } from '../config/env.js';

export const CSRF_COOKIE = 'dw_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Signed double-submit token: "<nonce>.<hmac(nonce)>". */
export function issueCsrfToken(secret: string): string {
  const nonce = randomToken(18);
  return `${nonce}.${hmacHex(secret, nonce)}`;
}

function validToken(secret: string, token: string): boolean {
  const [nonce, sig] = token.split('.');
  if (!nonce || !sig || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return safeEqualHex(sig, hmacHex(secret, nonce));
}

/**
 * CSRF + Origin protection for state-changing requests (SECURITY_REVIEW §5).
 * Runs before AccessGuard. Webhook routes are exempt: gateways cannot send our
 * token, so webhooks are verified server-to-server instead.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly origins: readonly string[];
  constructor(@Inject(ENV) private readonly env: Env) {
    this.origins = [env.WEB_ORIGIN, env.ADMIN_ORIGIN];
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    // Webhooks are authenticated by signature + server-side verification; the payment
    // simulator's own hosted page posts back to itself (it stands in for a gateway domain).
    if (SAFE.has(req.method) || req.path.startsWith('/v1/webhooks/') || req.path.startsWith('/v1/payments/simulator/')) return true;
    const origin = req.header('origin');
    if (origin && !this.origins.includes(origin)) throw new AppError('FORBIDDEN', 'Origin not allowed');
    const cookie = (req.cookies as Record<string, string | undefined> | undefined)?.[CSRF_COOKIE];
    const header = req.header(CSRF_HEADER);
    if (!cookie || !header || cookie !== header || !validToken(this.env.SESSION_SECRET, header)) {
      throw new AppError('FORBIDDEN', 'CSRF token missing or invalid');
    }
    return true;
  }
}
