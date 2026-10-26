import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { parseTaka, type VerifiedTransaction } from '@dudhwala/shared';
import { ENV, type Env } from '../config/env.js';
import { PaymentGateway, type CallbackClaim, type InitiateInput, type RefundResult } from './gateway.js';

/** Minimal fetch signature so tests can inject a fake HTTP layer. */
export type HttpFetch = (url: string, init?: { method?: string; body?: URLSearchParams; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export const HTTP_FETCH = Symbol('HTTP_FETCH');

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/**
 * SSLCOMMERZ hosted-checkout adapter (OPEN_DECISIONS E1 candidate).
 *
 * Endpoints and parameters follow SSLCOMMERZ's own Node library
 * (github.com/sslcommerz/SSLCommerz-NodeJS, `sslcommerz-lts` 1.2.0) and the v4
 * docs at sandbox-gw.sslcommerz.com/doc/v4 (Order Validation, IPN, Order Query):
 *  - session:      POST {base}/gwprocess/v4/api.php
 *  - status query: GET  {base}/validator/api/merchantTransIDvalidationAPI.php?tran_id=…
 *  - refund:       GET  {base}/validator/api/merchantTransIDvalidationAPI.php?bank_tran_id=…&refund_amount=…
 *  - refund query: GET  {base}/validator/api/merchantTransIDvalidationAPI.php?refund_ref_id=…
 * base = https://sandbox.sslcommerz.com or https://securepay.sslcommerz.com (live).
 *
 * Safety does not depend on the IPN hash: an IPN only names a transaction; the
 * payment becomes PAID only after the server-side transaction query matches
 * our tran_id, amount and BDT (PaymentsService.verifyAndApply).
 * The IPN hash check (verify_sign) implements the scheme used by SSLCOMMERZ's
 * published PHP integration; confirm it with SSLCOMMERZ during onboarding.
 */
@Injectable()
export class SslCommerzGateway extends PaymentGateway {
  readonly code = 'sslcommerz';
  private readonly logger = new Logger('SSLCOMMERZ');
  private readonly base: string;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(HTTP_FETCH) private readonly http: HttpFetch,
  ) {
    super();
    this.base = env.SSLCOMMERZ_LIVE === 'true' ? 'https://securepay.sslcommerz.com' : 'https://sandbox.sslcommerz.com';
  }

  private creds(): { store_id: string; store_passwd: string } {
    return { store_id: this.env.SSLCOMMERZ_STORE_ID, store_passwd: this.env.SSLCOMMERZ_STORE_PASSWORD };
  }

  private async call(path: string, init: { method: 'GET' | 'POST'; params: Record<string, string> }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams({ ...init.params, ...this.creds() });
    const url = init.method === 'GET' ? `${this.base}${path}?${params.toString()}` : `${this.base}${path}`;
    const res = await this.http(url, {
      method: init.method,
      ...(init.method === 'POST' ? { body: params, headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`SSLCOMMERZ HTTP ${res.status} on ${path}`);
    const body = await res.json();
    if (!body || typeof body !== 'object') throw new Error(`SSLCOMMERZ returned a non-object body on ${path}`);
    return body as Record<string, unknown>;
  }

  async initiate(input: InitiateInput): Promise<{ redirectUrl: string; providerSessionId: string }> {
    // The browser comes back by form POST; the API turns that into a GET redirect to the storefront.
    // Only the order id travels; the API rebuilds the storefront URL from its own config (no open redirect).
    const orderId = new URL(input.returnUrl).searchParams.get('order') ?? '';
    const back = (hint: string) => `${this.env.API_PUBLIC_URL}/v1/webhooks/payments/sslcommerz/return?order=${encodeURIComponent(orderId)}&hint=${hint}`;
    const taka = (input.amountPoisha / 100).toFixed(2);
    const r = await this.call('/gwprocess/v4/api.php', {
      method: 'POST',
      params: {
        total_amount: taka,
        currency: 'BDT',
        tran_id: input.merchantTranId,
        success_url: back('success'),
        fail_url: back('failed'),
        cancel_url: back('cancelled'),
        ipn_url: input.ipnUrl,
        shipping_method: 'NO', // delivery is arranged by Dudhwala, not the gateway
        num_of_item: '1',
        product_name: `Order ${input.orderNumber}`,
        product_category: 'Food',
        product_profile: 'physical-goods',
        cus_name: 'Customer',
        cus_email: 'noreply@example.invalid',
        cus_add1: 'Sylhet',
        cus_city: 'Sylhet',
        cus_country: 'Bangladesh',
        cus_phone: input.customerPhone,
        value_a: input.orderNumber,
      },
    });
    const url = str(r.GatewayPageURL);
    if (str(r.status) !== 'SUCCESS' || !/^https:\/\/[a-z0-9.-]+\.sslcommerz\.com\//.test(url)) {
      throw new Error(`SSLCOMMERZ session failed: ${str(r.failedreason).slice(0, 200) || 'unknown reason'}`);
    }
    return { redirectUrl: url, providerSessionId: str(r.sessionkey).slice(0, 190) };
  }

  /** Transaction query by our tran_id — the source of truth for "paid". */
  async verify(merchantTranId: string): Promise<VerifiedTransaction | null> {
    const r = await this.call('/validator/api/merchantTransIDvalidationAPI.php', { method: 'GET', params: { tran_id: merchantTranId, v: '1', format: 'json' } });
    const elements = Array.isArray(r.element) ? (r.element as Record<string, unknown>[]) : [];
    const mine = elements.filter((e) => str(e.tran_id) === merchantTranId);
    if (mine.length === 0) return null;
    const success = mine.find((e) => ['VALID', 'VALIDATED'].includes(str(e.status).toUpperCase()));
    const e = success ?? mine[0];
    if (!e) return null;
    const status = mapStatus(str(e.status));
    if (status === 'SUCCESS' && str(e.risk_level) === '1') {
      this.logger.warn(`transaction ${merchantTranId} flagged high risk by SSLCOMMERZ (risk_level=1); review before dispatch`);
    }
    let amountPoisha = -1;
    try {
      amountPoisha = parseTaka(str(e.amount));
    } catch {
      /* leave -1 so the amount check fails closed */
    }
    return {
      merchantTranId,
      providerTranId: str(e.bank_tran_id).slice(0, 128),
      status,
      amountPoisha,
      currency: str(e.currency_type) || str(e.currency),
    };
  }

  async parseCallback(req: Request): Promise<CallbackClaim> {
    const body = ((req.body ?? {}) as Record<string, unknown>) ?? {};
    const tran = str(body.tran_id).slice(0, 64);
    const valId = str(body.val_id).slice(0, 128);
    return {
      providerEventId: valId ? `ipn-${valId}-${str(body.status)}` : `ipn-${tran}-${str(body.status)}-${str(body.tran_date)}`.slice(0, 128),
      merchantTranId: tran,
      signatureValid: this.verifySign(body),
      payload: body,
    };
  }

  /**
   * verify_sign = md5( sorted "key=value&…" over the fields listed in verify_key,
   * plus store_passwd = md5(store password) ). Unknown/missing → invalid.
   */
  verifySign(body: Record<string, unknown>): boolean {
    const sign = str(body.verify_sign);
    const keys = str(body.verify_key).split(',').map((k) => k.trim()).filter(Boolean);
    if (!/^[0-9a-f]{32}$/i.test(sign) || keys.length === 0) return false;
    const fields: Record<string, string> = {};
    for (const k of keys) fields[k] = str(body[k]);
    fields.store_passwd = md5(this.env.SSLCOMMERZ_STORE_PASSWORD);
    const joined = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('&');
    const expected = Buffer.from(md5(joined), 'hex');
    const got = Buffer.from(sign.toLowerCase(), 'hex');
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  async refund(input: { merchantTranId: string; providerTranId: string; amountPoisha: number; reason: string }): Promise<RefundResult> {
    const r = await this.call('/validator/api/merchantTransIDvalidationAPI.php', {
      method: 'GET',
      params: {
        bank_tran_id: input.providerTranId,
        refund_amount: (input.amountPoisha / 100).toFixed(2),
        refund_remarks: input.reason.slice(0, 200),
        refe_id: input.merchantTranId,
        v: '1',
        format: 'json',
      },
    });
    const ref = str(r.refund_ref_id).slice(0, 128);
    const status = str(r.status).toLowerCase();
    if (str(r.APIConnect) === 'DONE' && (status === 'success' || status === 'processing') && ref) return { providerRefundId: ref, status: 'SUBMITTED' };
    this.logger.warn(`refund rejected for ${input.merchantTranId}: ${str(r.errorReason).slice(0, 200)}`);
    return { providerRefundId: ref || `rejected-${input.merchantTranId}`, status: 'FAILED' };
  }

  override async refundStatus(providerRefundId: string): Promise<'SUCCEEDED' | 'SUBMITTED' | 'FAILED'> {
    const r = await this.call('/validator/api/merchantTransIDvalidationAPI.php', { method: 'GET', params: { refund_ref_id: providerRefundId, v: '1', format: 'json' } });
    const s = str(r.status).toLowerCase();
    if (s === 'refunded') return 'SUCCEEDED';
    if (s === 'cancelled' || s === 'failed') return 'FAILED';
    return 'SUBMITTED';
  }
}

export function mapStatus(s: string): VerifiedTransaction['status'] {
  switch (s.toUpperCase()) {
    case 'VALID':
    case 'VALIDATED':
      return 'SUCCESS';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELLED';
    default:
      return 'PENDING'; // PENDING, UNATTEMPTED, anything unknown: not paid
  }
}
