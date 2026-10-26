import { Controller, Get, Inject, Query } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { maskPhone, tryNormalizeBdMobile } from '@dudhwala/shared';
import { Public } from '../access/decorators.js';
import { notFound } from '../common/errors.js';

/** SMS provider port (OPEN_DECISIONS F2). Real providers implement this later. */
export abstract class SmsSender {
  abstract send(toE164: string, text: string): Promise<{ providerMessageId: string }>;
}

/**
 * Local development only — env validation refuses it in staging/production.
 * Prints the message (masked number) and keeps the last 100 in memory so
 * automated end-to-end tests can read OTP codes via the dev outbox.
 */
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS(log)');
  readonly outbox: { to: string; text: string; at: string }[] = [];
  async send(toE164: string, text: string): Promise<{ providerMessageId: string }> {
    this.logger.warn(`DEV SMS to ${maskPhone(toE164)}: ${text}`);
    this.outbox.push({ to: toE164, text, at: new Date().toISOString() });
    if (this.outbox.length > 100) this.outbox.shift();
    return { providerMessageId: `log-${Date.now()}` };
  }
}

/**
 * DEV ONLY: lets E2E tests read the log provider's messages. Registered only when
 * NODE_ENV is development/test, SMS_PROVIDER=log and ENABLE_DEV_OUTBOX=true
 * (see app.module.ts). Never available where real SMS are sent.
 */
@Controller('dev/sms')
export class DevSmsOutboxController {
  constructor(@Inject(SmsSender) private readonly sms: SmsSender) {}

  @Get()
  @Public()
  last(@Query('phone') phone: string) {
    if (!(this.sms instanceof LogSmsSender)) throw notFound('Outbox');
    const to = tryNormalizeBdMobile(phone ?? '');
    return this.sms.outbox.filter((m) => m.to === to).slice(-5);
  }
}

export interface HttpSmsConfig {
  url: string;
  method: 'GET' | 'POST';
  /** Static provider parameters as a query string, e.g. "api_key=…&senderid=…&type=text". Secret: from env only. */
  staticParams: string;
  toParam: string;
  textParam: string;
  phoneFormat: 'e164' | '880' | '0';
  /** Response body must match this (case-insensitive) to count as accepted. */
  successPattern: string;
}

/**
 * Generic HTTP SMS adapter for Bangladeshi bulk-SMS gateways (OPEN_DECISIONS F2).
 * Most local providers accept one GET/POST with api key, sender id, number and
 * message; the exact parameter names and success response come from the chosen
 * provider's documentation and are set in env (SMS_HTTP_*). Unicode (Bangla)
 * text is sent UTF-8 URL-encoded.
 */
export class HttpSmsSender extends SmsSender {
  constructor(
    private readonly cfg: HttpSmsConfig,
    private readonly fetchImpl: (url: string, init: { method: string; body?: URLSearchParams; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = fetch,
  ) {
    super();
  }

  static formatPhone(e164: string, f: HttpSmsConfig['phoneFormat']): string {
    if (f === 'e164') return e164;
    return f === '880' ? e164.slice(1) : e164.slice(3);
  }

  async send(toE164: string, text: string): Promise<{ providerMessageId: string }> {
    const params = new URLSearchParams(this.cfg.staticParams);
    params.set(this.cfg.toParam, HttpSmsSender.formatPhone(toE164, this.cfg.phoneFormat));
    params.set(this.cfg.textParam, text);
    const res =
      this.cfg.method === 'GET'
        ? await this.fetchImpl(`${this.cfg.url}${this.cfg.url.includes('?') ? '&' : '?'}${params.toString()}`, { method: 'GET', signal: AbortSignal.timeout(15_000) })
        : await this.fetchImpl(this.cfg.url, { method: 'POST', body: params, headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(15_000) });
    const body = (await res.text()).slice(0, 500);
    if (!res.ok || !new RegExp(this.cfg.successPattern, 'i').test(body)) {
      // Never include the URL: it carries the API key.
      throw new Error(`SMS provider rejected message for ${maskPhone(toE164)} (HTTP ${res.status}): ${body.slice(0, 200)}`);
    }
    return { providerMessageId: body.slice(0, 120) };
  }
}
