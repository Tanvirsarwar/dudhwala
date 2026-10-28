import { Body, Controller, Header, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, CustomerOnly, Public } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/http.js';
import { PaymentsService } from './payments.service.js';

const Outcome = z.object({ outcome: z.enum(['success', 'fail']) }).strict();

@Controller()
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  /** Customer begins payment for their own bulk order. */
  @Post('orders/:id/payment')
  @CustomerOnly()
  @HttpCode(200)
  start(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.payments.start(p, id, req);
  }

  /** Provider-to-server webhook. Authenticated by signature over the raw body, not by cookies. */
  @Post('webhooks/payments')
  @Public()
  @HttpCode(200)
  @Header('cache-control', 'no-store')
  async webhook(@Req() req: Request) {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) throw new AppError('VALIDATION_FAILED', 'Expected a JSON body');
    return { result: await this.payments.handleWebhook(raw, req.header('x-dw-signature'), req) };
  }

  /** SANDBOX ONLY (404 unless PAYMENTS_PROVIDER=sandbox): lets the demo/staging checkout finish a fake payment. */
  @Post('payments/sandbox/:merchantTranId/complete')
  @CustomerOnly()
  @HttpCode(200)
  async sandboxComplete(@CurrentPrincipal() p: Principal, @Param('merchantTranId') tran: string, @Body() body: unknown, @Req() req: Request) {
    return { result: await this.payments.sandboxComplete(p, tran, parse(Outcome, body).outcome, req) };
  }
}
