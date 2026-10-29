import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../common/http.js';
import { CurrentPrincipal, Public } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';
import { AppError } from '../common/errors.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';
import { CartService } from './cart.service.js';

const Qty = z.object({ quantity: z.number().int().min(0).max(999) }).strict();

/** Cart works for anonymous visitors and customers; staff sessions are refused. */
@Controller('cart')
export class CartController {
  constructor(
    @Inject(CartService) private readonly carts: CartService,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
  ) {}

  private who(p: Principal | undefined): Principal | undefined {
    if (p?.kind === 'STAFF') throw new AppError('FORBIDDEN', 'Use a customer account to shop');
    return p;
  }

  @Get()
  @Public({ audience: 'CUSTOMER' })
  get(@CurrentPrincipal() p: Principal | undefined, @Req() req: Request) {
    return this.carts.viewFor(this.who(p), req);
  }

  @Put('items/:variantId')
  @Public({ audience: 'CUSTOMER' })
  async setItem(
    @CurrentPrincipal() p: Principal | undefined,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limits.hit(LIMITS.cartPerIp, req.ip);
    return this.carts.setQuantity(this.who(p), req, res, variantId, parse(Qty, body).quantity);
  }
}
