import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CurrentPrincipal, CustomerOnly } from '../access/decorators.js';
import type { Principal } from '../access/principal.js';
import { AppError } from '../common/errors.js';
import { parse } from '../common/http.js';
import { OrdersService, type PlaceOrderInput } from './orders.service.js';

const Name = z.string().trim().min(1).max(80);
const Phone = z.string().trim().min(10).max(20);
const PlaceOrder = z
  .object({
    method: z.enum(['HOME_DELIVERY', 'EXPRESS_PICKUP', 'BULK_ORDER']),
    zone: z.enum(['IN_CITY', 'OUTER_CITY']).nullable().optional(),
    lines: z.array(z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(1).max(999) }).strict()).min(1).max(100),
    address: z.object({ name: Name, phone: Phone, line1: z.string().trim().min(1).max(300), landmark: z.string().trim().max(120).nullable().optional() }).strict().optional(),
    contact: z.object({ name: Name, phone: Phone }).strict().optional(),
    outletId: z.string().uuid().nullable().optional(),
    pickupAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** A customer sees and creates only their own orders. */
@Controller('orders')
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  @CustomerOnly()
  async place(@CurrentPrincipal() p: Principal, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (!key || !IDEMPOTENCY_KEY.test(key)) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header (8-64 letters, digits, - or _) is required');
    const b = parse(PlaceOrder, body);
    if (b.method === 'HOME_DELIVERY' && !b.address) throw new AppError('VALIDATION_FAILED', 'address is required for home delivery');
    if (b.method !== 'HOME_DELIVERY' && !b.contact) throw new AppError('VALIDATION_FAILED', 'contact is required');
    const contact = b.method === 'HOME_DELIVERY' ? { name: (b.address as { name: string }).name, phone: (b.address as { phone: string }).phone, line1: (b.address as { line1: string }).line1, landmark: b.address?.landmark ?? null } : { name: (b.contact as { name: string }).name, phone: (b.contact as { phone: string }).phone, line1: null, landmark: null };
    const input: PlaceOrderInput = {
      method: b.method,
      zone: b.zone ?? null,
      lines: b.lines,
      contact,
      outletId: b.outletId ?? null,
      pickupAt: b.pickupAt ? new Date(b.pickupAt) : null,
    };
    const r = await this.orders.place(p.userId, key, input, req);
    res.status(r.replayed ? 200 : 201);
    return { ...r.order, replayed: r.replayed };
  }

  @Get()
  @CustomerOnly()
  list(@CurrentPrincipal() p: Principal) {
    return this.orders.listForCustomer(p);
  }

  @Get(':id')
  @CustomerOnly()
  get(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.getForCustomer(p, id);
  }

  @Get(':id/status')
  @CustomerOnly()
  @HttpCode(200)
  async status(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const o = await this.orders.getForCustomer(p, id);
    return { id: o.id, status: o.status, method: o.method };
  }
}
