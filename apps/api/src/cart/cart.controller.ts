import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { parse } from '../common/http.js';
import { CurrentPrincipal, Public } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';
import { AppError } from '../common/errors.js';
import { LIMITS, RateLimitService } from '../rate-limit/rate-limit.service.js';
import { CartService, MAX_LINE_QTY } from './cart.service.js';

const Qty = z.object({ quantity: z.number().int().min(0).max(MAX_LINE_QTY) }).strict();
const Area = z.object({ areaId: z.string().uuid().nullable() }).strict();
const Coupon = z.object({ code: z.string().trim().min(2).max(40) }).strict();

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
  setItem(
    @CurrentPrincipal() p: Principal | undefined,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.carts.setQuantity(this.who(p), req, res, variantId, parse(Qty, body).quantity);
  }

  @Put('area')
  @Public({ audience: 'CUSTOMER' })
  setArea(@CurrentPrincipal() p: Principal | undefined, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.carts.setArea(this.who(p), req, res, parse(Area, body).areaId);
  }

  @Put('coupon')
  @Public({ audience: 'CUSTOMER' })
  async setCoupon(@CurrentPrincipal() p: Principal | undefined, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.limits.hit(LIMITS.couponPerIp, req.ip); // slows down coupon-code guessing
    return this.carts.setCoupon(this.who(p), req, res, parse(Coupon, body).code.toUpperCase());
  }

  @Delete('coupon')
  @Public({ audience: 'CUSTOMER' })
  clearCoupon(@CurrentPrincipal() p: Principal | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.carts.setCoupon(this.who(p), req, res, null);
  }
}
