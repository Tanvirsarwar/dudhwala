import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { multiply, sum, type Poisha } from '@dudhwala/shared';
import { Clock } from '../common/clock.js';
import { newId, randomToken, sha256Hex } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { AvailabilityService } from '../catalog/availability.service.js';
import { MediaService } from '../media/media.js';
import type { Principal } from '../access/principal.js';

export const CART_COOKIE = 'dw_cart';
const CART_TTL_MS = 30 * 86_400_000;
export const MAX_LINE_QTY = 99;

export interface CartView {
  id: string | null;
  areaId: string | null;
  couponCode: string | null;
  lines: {
    variantId: string;
    productSlug: string;
    nameBn: string;
    nameEn: string | null;
    labelBn: string;
    image: string | null;
    unitPricePoisha: Poisha;
    quantity: number;
    lineTotalPoisha: Poisha;
    available: boolean;
    maxQty: number;
  }[];
  subtotalPoisha: Poisha;
  itemCount: number;
  warnings: { variantId: string; code: 'UNAVAILABLE' | 'QUANTITY_REDUCED_AVAILABLE' }[];
  areaChecked: boolean;
}

/**
 * Server-side cart (TRD §4). Prices are never stored in the cart: every view
 * re-prices from the catalogue (FR-3). Anonymous carts are keyed by a random
 * HttpOnly cookie token (only its hash is stored).
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AvailabilityService) private readonly availability: AvailabilityService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  private anonHash(req: Request): string | null {
    const t = (req.cookies as Record<string, string | undefined> | undefined)?.[CART_COOKIE];
    return t && t.length <= 128 ? sha256Hex(t) : null;
  }

  async find(p: Principal | undefined, req: Request) {
    if (p?.kind === 'CUSTOMER') return this.prisma.cart.findUnique({ where: { userId: p.userId } });
    const h = this.anonHash(req);
    if (!h) return null;
    const cart = await this.prisma.cart.findUnique({ where: { anonymousTokenHash: h } });
    return cart && cart.expiresAt > this.clock.now() ? cart : null;
  }

  async findOrCreate(p: Principal | undefined, req: Request, res: Response) {
    const existing = await this.find(p, req);
    const expiresAt = new Date(this.clock.now().getTime() + CART_TTL_MS);
    if (existing) return existing;
    if (p?.kind === 'CUSTOMER') return this.prisma.cart.create({ data: { id: newId(), userId: p.userId, expiresAt } });
    const token = randomToken();
    res.cookie(CART_COOKIE, token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production' || this.env.NODE_ENV === 'staging',
      sameSite: 'lax',
      path: '/',
      maxAge: CART_TTL_MS,
    });
    return this.prisma.cart.create({ data: { id: newId(), anonymousTokenHash: sha256Hex(token), expiresAt } });
  }

  async setQuantity(p: Principal | undefined, req: Request, res: Response, variantId: string, quantity: number): Promise<CartView> {
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, status: 'ACTIVE', product: { status: 'ACTIVE' } } });
    if (!variant && quantity > 0) throw notFound('Product');
    const cart = await this.findOrCreate(p, req, res);
    if (quantity === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, productVariantId: variantId } });
    } else {
      const avail = (await this.availability.forVariants([variantId], cart.areaId)).get(variantId);
      if (!avail || avail.maxQty === 0) throw new AppError('OUT_OF_STOCK', 'এই পণ্যটি এখন স্টকে নেই', [{ variantId, available: 0 }]);
      if (quantity > avail.maxQty) throw new AppError('OUT_OF_STOCK', `সর্বোচ্চ ${avail.maxQty}টি অর্ডার করা যাবে`, [{ variantId, requested: quantity, available: avail.maxQty }]);
      await this.prisma.cartItem.upsert({
        where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variantId } },
        update: { quantity },
        create: { cartId: cart.id, productVariantId: variantId, quantity },
      });
    }
    await this.touch(cart.id);
    return this.view(cart.id);
  }

  async setArea(p: Principal | undefined, req: Request, res: Response, areaId: string | null): Promise<CartView> {
    if (areaId && !(await this.prisma.area.findFirst({ where: { id: areaId, active: true } }))) throw notFound('Area');
    const cart = await this.findOrCreate(p, req, res);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { areaId } });
    return this.view(cart.id);
  }

  async setCoupon(p: Principal | undefined, req: Request, res: Response, code: string | null): Promise<CartView> {
    const cart = await this.findOrCreate(p, req, res);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: code } });
    return this.view(cart.id);
  }

  private touch(cartId: string) {
    return this.prisma.cart.update({ where: { id: cartId }, data: { expiresAt: new Date(this.clock.now().getTime() + CART_TTL_MS) } });
  }

  async viewFor(p: Principal | undefined, req: Request): Promise<CartView> {
    const cart = await this.find(p, req);
    return cart ? this.view(cart.id) : emptyCart();
  }

  async view(cartId: string, tx: Tx = this.prisma): Promise<CartView> {
    const cart = await tx.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { items: { include: { variant: { include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } } } } } },
    });
    const avail = await this.availability.forVariants(cart.items.map((i) => i.productVariantId), cart.areaId);
    const warnings: CartView['warnings'] = [];
    const lines = cart.items
      .sort((a, b) => a.variant.product.nameBn.localeCompare(b.variant.product.nameBn))
      .map((i) => {
        const a = avail.get(i.productVariantId) ?? { maxQty: 0 };
        const sellable = i.variant.status === 'ACTIVE' && i.variant.product.status === 'ACTIVE';
        const available = sellable && a.maxQty >= i.quantity;
        if (!available) warnings.push({ variantId: i.productVariantId, code: sellable && a.maxQty > 0 ? 'QUANTITY_REDUCED_AVAILABLE' : 'UNAVAILABLE' });
        const img = i.variant.product.images[0];
        return {
          variantId: i.productVariantId,
          productSlug: i.variant.product.slug,
          nameBn: i.variant.product.nameBn,
          nameEn: i.variant.product.nameEn,
          labelBn: i.variant.labelBn,
          image: img ? this.media.url(img.storageKey) : null,
          unitPricePoisha: i.variant.pricePoisha,
          quantity: i.quantity,
          lineTotalPoisha: multiply(i.variant.pricePoisha, i.quantity),
          available,
          maxQty: sellable ? Math.min(MAX_LINE_QTY, a.maxQty) : 0,
        };
      });
    return {
      id: cart.id,
      areaId: cart.areaId,
      couponCode: cart.couponCode,
      lines,
      subtotalPoisha: sum(lines.map((l) => l.lineTotalPoisha)),
      itemCount: sum(lines.map((l) => l.quantity)),
      warnings,
      areaChecked: Boolean(cart.areaId),
    };
  }

  /**
   * On customer login, folds the anonymous cart into the customer's cart:
   * quantities add up, capped at MAX_LINE_QTY (availability is re-checked on view).
   */
  async mergeOnLogin(userId: string, req: Request, res: Response): Promise<void> {
    const h = this.anonHash(req);
    if (!h) return;
    await this.prisma.$transaction(async (tx) => {
      const anon = await tx.cart.findUnique({ where: { anonymousTokenHash: h }, include: { items: true } });
      if (!anon) return;
      const mine = await tx.cart.findUnique({ where: { userId } });
      if (!mine) {
        await tx.cart.update({ where: { id: anon.id }, data: { userId, anonymousTokenHash: null } });
        return;
      }
      for (const item of anon.items) {
        const existing = await tx.cartItem.findUnique({ where: { cartId_productVariantId: { cartId: mine.id, productVariantId: item.productVariantId } } });
        const quantity = Math.min(MAX_LINE_QTY, (existing?.quantity ?? 0) + item.quantity);
        await tx.cartItem.upsert({
          where: { cartId_productVariantId: { cartId: mine.id, productVariantId: item.productVariantId } },
          update: { quantity },
          create: { cartId: mine.id, productVariantId: item.productVariantId, quantity },
        });
      }
      if (!mine.areaId && anon.areaId) await tx.cart.update({ where: { id: mine.id }, data: { areaId: anon.areaId } });
      await tx.cart.delete({ where: { id: anon.id } });
    });
    res.clearCookie(CART_COOKIE, { path: '/' });
  }

  async clear(cartId: string, tx: Tx): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
    await tx.cart.update({ where: { id: cartId }, data: { couponCode: null } });
  }
}

export function emptyCart(): CartView {
  return { id: null, areaId: null, couponCode: null, lines: [], subtotalPoisha: 0, itemCount: 0, warnings: [], areaChecked: false };
}
