import { Body, Controller, Get, Header, HttpCode, Inject, Injectable, Param, Post, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { formatTaka, type VerifiedTransaction } from '@dudhwala/shared';
import { hmacHex, newId, randomToken, safeEqualHex } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { parse } from '../common/http.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from '../access/decorators.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PaymentGateway, type CallbackClaim, type InitiateInput, type RefundResult } from './gateway.js';

export const FAKE_IPN_JOB = 'payments.fake_ipn';
export const FAKE_SIGNATURE_HEADER = 'x-simulator-signature';

/**
 * Payment SIMULATOR. Behaves like a hosted-checkout gateway: its own ledger,
 * a hosted page, signed server-to-server notifications (sent asynchronously,
 * possibly more than once) and a status-query API. Exists so checkout,
 * webhooks, reconciliation and refunds can be built and tested before a real
 * merchant account exists. Env validation refuses it in production.
 */
@Injectable()
export class FakeGateway extends PaymentGateway {
  readonly code = 'fake';
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    super();
  }

  async initiate(input: InitiateInput): Promise<{ redirectUrl: string; providerSessionId: string }> {
    const sessionId = randomToken(18);
    await this.prisma.fakeGatewayTxn.create({
      data: { sessionId, merchantTranId: input.merchantTranId, providerTranId: `SIM-${newId()}`, amountPoisha: input.amountPoisha },
    });
    // Return URL and IPN URL are fixed by our own configuration, never taken from the request.
    return { redirectUrl: `${this.env.API_PUBLIC_URL}/v1/payments/simulator/${sessionId}`, providerSessionId: sessionId };
  }

  async verify(merchantTranId: string): Promise<VerifiedTransaction | null> {
    const t = await this.prisma.fakeGatewayTxn.findUnique({ where: { merchantTranId } });
    if (!t) return null;
    return {
      merchantTranId: t.merchantTranId,
      providerTranId: t.providerTranId,
      amountPoisha: t.amountPoisha,
      currency: t.currency,
      status: t.status === 'SUCCESS' ? 'SUCCESS' : t.status === 'INITIATED' ? 'PENDING' : t.status === 'FAILED' ? 'FAILED' : 'CANCELLED',
    };
  }

  sign(body: string): string {
    return hmacHex(this.env.PAYMENTS_WEBHOOK_SECRET, body);
  }

  async parseCallback(req: Request): Promise<CallbackClaim> {
    const raw = JSON.stringify(req.body ?? {});
    const sig = req.header(FAKE_SIGNATURE_HEADER) ?? '';
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signatureValid = /^[0-9a-f]{64}$/.test(sig) && safeEqualHex(sig, this.sign(raw));
    const eventId = typeof body.eventId === 'string' ? body.eventId.slice(0, 128) : `unsigned-${newId()}`;
    const merchantTranId = typeof body.merchantTranId === 'string' ? body.merchantTranId.slice(0, 64) : '';
    return { providerEventId: eventId, merchantTranId, signatureValid, payload: body };
  }

  async refund(input: { merchantTranId: string; amountPoisha: number }): Promise<RefundResult> {
    const t = await this.prisma.fakeGatewayTxn.findUnique({ where: { merchantTranId: input.merchantTranId } });
    if (!t || t.status !== 'SUCCESS' || t.refundedPoisha + input.amountPoisha > t.amountPoisha) return { providerRefundId: `SIMR-${newId()}`, status: 'FAILED' };
    await this.prisma.fakeGatewayTxn.update({ where: { sessionId: t.sessionId }, data: { refundedPoisha: { increment: input.amountPoisha } } });
    return { providerRefundId: `SIMR-${newId()}`, status: 'SUCCEEDED' };
  }
}

const Complete = z.object({ outcome: z.enum(['SUCCESS', 'FAILED', 'CANCELLED']) }).strict();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** The simulator's "hosted payment page" — what a real gateway would host on its own domain. */
@Controller('payments/simulator')
export class FakeGatewayController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get(':sessionId')
  @Public()
  @Header('content-type', 'text/html; charset=utf-8')
  async page(@Param('sessionId') sessionId: string, @Res({ passthrough: true }) res: Response): Promise<string> {
    // form-action must also allow the storefront: browsers apply it to the redirect after the POST.
    res.setHeader('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${new URL(this.env.WEB_ORIGIN).origin}; frame-ancestors 'none'`);
    const t = await this.prisma.fakeGatewayTxn.findUnique({ where: { sessionId } });
    if (!t) throw notFound('Payment session');
    const payment = await this.prisma.payment.findUnique({ where: { merchantTranId: t.merchantTranId }, include: { order: { select: { orderNumber: true } } } });
    const btn = (o: string, label: string, color: string) =>
      `<form method="post" action="/v1/payments/simulator/${esc(sessionId)}/complete"><input type="hidden" name="outcome" value="${o}"><button style="width:100%;padding:14px;margin:6px 0;border:0;border-radius:10px;font-size:16px;color:#fff;background:${color}">${label}</button></form>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payment simulator</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color:#1B1D4A">
<p style="background:#FFF4CC;padding:10px;border-radius:8px"><strong>SIMULATOR — no real money.</strong> This page stands in for a payment gateway during development and demos.</p>
<h1 style="font-size:20px">Order ${esc(payment?.order.orderNumber ?? '')}</h1>
<p style="font-size:28px;font-weight:700">${esc(formatTaka(t.amountPoisha, 'en'))}</p>
<p>Status: ${esc(t.status)}</p>
${t.status === 'INITIATED' ? btn('SUCCESS', 'Pay (simulate success)', '#1E7A46') + btn('FAILED', 'Simulate failure', '#B42318') + btn('CANCELLED', 'Cancel', '#555874') : ''}
</body></html>`;
  }

  @Post(':sessionId/complete')
  @Public()
  @HttpCode(303)
  async complete(@Param('sessionId') sessionId: string, @Body() body: unknown, @Res() res: Response): Promise<void> {
    const { outcome } = parse(Complete, body);
    const t = await this.prisma.fakeGatewayTxn.findUnique({ where: { sessionId } });
    if (!t) throw notFound('Payment session');
    if (t.status === 'INITIATED') {
      await this.prisma.fakeGatewayTxn.update({ where: { sessionId }, data: { status: outcome } });
      // Like real gateways, notify asynchronously (and the job runner may deliver more than once).
      await this.jobs.enqueue(FAKE_IPN_JOB, { merchantTranId: t.merchantTranId, eventId: `SIMEV-${newId()}` });
    }
    const payment = await this.prisma.payment.findUnique({ where: { merchantTranId: t.merchantTranId } });
    if (!payment) throw new AppError('NOT_FOUND', 'Payment not found');
    // The status in this URL is informational only; the storefront polls the API.
    res.redirect(303, `${this.env.WEB_ORIGIN}/checkout/return?order=${payment.orderId}&hint=${outcome.toLowerCase()}`);
  }
}
