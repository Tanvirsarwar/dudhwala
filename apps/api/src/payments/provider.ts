import { createHmac } from 'node:crypto';
import { safeEqualHex } from '../common/crypto.js';
import { AppError } from '../common/errors.js';

export interface PaymentSession {
  /** Where to send the customer, or null when the provider needs no redirect (sandbox). */
  redirectUrl: string | null;
}

export interface PaymentEventData {
  eventId: string;
  merchantTranId: string;
  providerTranId: string;
  status: 'PAID' | 'FAILED' | 'CANCELLED';
  amountPoisha: number;
  currency: string;
}

/**
 * Payment provider port. A real gateway adapter (bKash, SSLCOMMERZ, …) implements this once the owner has chosen
 * one and holds credentials; until then only `DisabledProvider` (production) and `SandboxProvider`
 * (development, tests, clearly labelled staging) exist. Adapters must verify the signature of every webhook
 * and must not trust browser redirects as proof of payment.
 */
export abstract class PaymentProvider {
  abstract readonly name: string;
  /** false = online payments are off; bulk orders cannot be placed. */
  abstract readonly enabled: boolean;
  /** true only for the sandbox: fake money, no real gateway behind it. */
  abstract readonly sandbox: boolean;
  abstract createSession(input: { merchantTranId: string; amountPoisha: number; orderNumber: string }): Promise<PaymentSession>;
  /** Returns the event when `signature` proves the body came from the provider, otherwise null. Never throws on bad input. */
  abstract verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEventData | null;
}

export class DisabledProvider extends PaymentProvider {
  readonly name = 'disabled';
  readonly enabled = false;
  readonly sandbox = false;
  async createSession(): Promise<PaymentSession> {
    throw new AppError('PAYMENTS_DISABLED', 'অনলাইন পেমেন্ট এখনো চালু হয়নি');
  }
  verifyWebhook(): PaymentEventData | null {
    return null;
  }
}

export const signSandboxBody = (secret: string, body: string | Buffer): string => createHmac('sha256', secret).update(body).digest('hex');

/**
 * SANDBOX — moves no real money. Webhooks carry an HMAC-SHA256 of the raw body in `x-dw-signature`,
 * which is the same shape a real adapter would verify. Refused in production by env validation.
 */
export class SandboxProvider extends PaymentProvider {
  readonly name = 'sandbox';
  readonly enabled = true;
  readonly sandbox = true;
  constructor(private readonly secret: string) {
    super();
  }

  async createSession(): Promise<PaymentSession> {
    return { redirectUrl: null };
  }

  verifyWebhook(rawBody: Buffer, signature: string | undefined): PaymentEventData | null {
    if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return null;
    if (!safeEqualHex(signature, signSandboxBody(this.secret, rawBody))) return null;
    try {
      const j = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      const ok =
        typeof j.eventId === 'string' && j.eventId.length > 0 && j.eventId.length <= 128 &&
        typeof j.merchantTranId === 'string' && j.merchantTranId.length <= 64 &&
        typeof j.providerTranId === 'string' && j.providerTranId.length <= 128 &&
        (j.status === 'PAID' || j.status === 'FAILED' || j.status === 'CANCELLED') &&
        typeof j.amountPoisha === 'number' && Number.isInteger(j.amountPoisha) &&
        typeof j.currency === 'string';
      return ok ? (j as unknown as PaymentEventData) : null;
    } catch {
      return null;
    }
  }

  /** Builds the signed body the sandbox "gateway" would post (used by the sandbox completion endpoint and tests). */
  signedEvent(event: PaymentEventData): { body: Buffer; signature: string } {
    const body = Buffer.from(JSON.stringify(event));
    return { body, signature: signSandboxBody(this.secret, body) };
  }
}
