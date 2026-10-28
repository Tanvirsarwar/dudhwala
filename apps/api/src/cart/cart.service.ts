import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Clock } from '../common/clock.js';
import { newId, randomToken, sha256Hex } from '../common/crypto.js';
import { AppError, notFound } from '../common/errors.js';
import { ENV, type Env } from '../config/env.js';
import { PrismaService, type Tx } from '../prisma/prisma.service.js';
import { CatalogService, outerToApi } from '../catalog/catalog.service.js';
import type { Principal } from '../access/principal.js';

export const CART_COOKIE = 'dw_cart';
const CART_TTL_MS = 30 * 86_400_000;

export interface CartLineView {
  variantId: string;
  productSlug: string;
  categorySlug: string;
  outerCityStatus: ReturnType<typeof outerToApi>;
  nameBn: string;
  nameEn: string | null;
  labelBn: string;
  image: string | null;
  /** null = price not set yet: the line cannot be ordered. */
  unitPricePoisha: number | null;
  quantity: number;
  lineTotalPoisha: number | null;
  available: boolean;
  maxQty: number;
}
export interface CartView {
  id: string | null;
  lines: CartLineView[];
  subtotalPoisha: number | null;
  itemCount: number;
  warnings: { variantId: string; code: 'UNAVAILABLE' | 'QUANTITY_REDUCED_AVAILABLE' | 'PRICE_NOT_SET' }[];
}

/**
 * Server-side cart. Prices are never stored in the cart: every view re-prices from the catalogue.
 * Anonymous carts are keyed by a random HttpOnly cookie token (only its hash is stored).
 */
@Injectable()
export class CartService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
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
    if (existing) return existing;
    const expiresAt = new Date(this.clock.now().getTime() + CART_TTL_MS);
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
    const variant = await this.prisma.productVariant.findFirst({ where: { id: variantId, product: { active: true, category: { active: true } } } });
    if (!variant && quantity > 0) throw notFound('Product');
    const cart = await this.findOrCreate(p, req, res);
    if (quantity === 0) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id, productVariantId: variantId } });
    } else if (variant) {
      if (variant.pricePoisha === null) throw new AppError('PRICE_NOT_SET', 'এই পণ্যের দাম এখনো নির্ধারিত হয়নি');
      const avail = (await this.catalog.availability(this.prisma, [variant])).get(variant.id) ?? 0;
      const cap = Math.min(variant.maxQty, avail);
      if (cap === 0) throw new AppError('OUT_OF_STOCK', 'এই পণ্যটি এখন স্টকে নেই', { variantId, available: 0 });
      if (quantity > cap) throw new AppError('OUT_OF_STOCK', `সর্বোচ্চ ${cap}টি অর্ডার করা যাবে`, { variantId, requested: quantity, available: cap });
      await this.prisma.cartItem.upsert({
        where: { cartId_productVariantId: { cartId: cart.id, productVariantId: variantId } },
        update: { quantity },
        create: { cartId: cart.id, productVariantId: variantId, quantity },
      });
    }
    await this.prisma.cart.update({ where: { id: cart.id }, data: { expiresAt: new Date(this.clock.now().getTime() + CART_TTL_MS) } });
    return this.view(cart.id);
  }

  async viewFor(p: Principal | undefined, req: Request): Promise<CartView> {
    const cart = await this.find(p, req);
    return cart ? this.view(cart.id) : { id: null, lines: [], subtotalPoisha: 0, itemCount: 0, warnings: [] };
  }

  async view(cartId: string, tx: Tx = this.prisma): Promise<CartView> {
    const cart = await tx.cart.findUniqueOrThrow({
      where: { id: cartId },
      include: { items: { include: { variant: { include: { product: { include: { category: true } } } } } } },
    });
    const avail = await this.catalog.availability(tx, cart.items.map((i) => i.variant));
    const warnings: CartView['warnings'] = [];
    const lines: CartLineView[] = cart.items
      .sort((a, b) => a.variant.product.nameBn.localeCompare(b.variant.product.nameBn))
      .map((i) => {
        const v = i.variant;
        const sellable = v.product.active && v.product.category.active;
        const left = avail.get(v.id) ?? 0;
        const cap = sellable ? Math.min(v.maxQty, left) : 0;
        const available = sellable && v.pricePoisha !== null && cap >= i.quantity;
        if (!sellable) warnings.push({ variantId: v.id, code: 'UNAVAILABLE' });
        else if (v.pricePoisha === null) warnings.push({ variantId: v.id, code: 'PRICE_NOT_SET' });
        else if (!available) warnings.push({ variantId: v.id, code: cap > 0 ? 'QUANTITY_REDUCED_AVAILABLE' : 'UNAVAILABLE' });
        return {
          variantId: v.id,
          productSlug: v.product.slug,
          categorySlug: v.product.category.slug,
          outerCityStatus: outerToApi(v.product.outerCityStatus),
          nameBn: v.product.nameBn,
          nameEn: v.product.nameEn,
          labelBn: v.labelBn,
          image: this.catalog.imageUrl(v.product),
          unitPricePoisha: v.pricePoisha,
          quantity: i.quantity,
          lineTotalPoisha: v.pricePoisha === null ? null : v.pricePoisha * i.quantity,
          available,
          maxQty: cap,
        };
      });
    return {
      id: cart.id,
      lines,
      subtotalPoisha: lines.some((l) => l.lineTotalPoisha === null) ? null : lines.reduce((s, l) => s + (l.lineTotalPoisha ?? 0), 0),
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      warnings,
    };
  }

  /** On customer login, folds the anonymous cart into the customer's cart (quantities add up; availability is re-checked on view). */
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
        const quantity = Math.min(999, (existing?.quantity ?? 0) + item.quantity);
        await tx.cartItem.upsert({
          where: { cartId_productVariantId: { cartId: mine.id, productVariantId: item.productVariantId } },
          update: { quantity },
          create: { cartId: mine.id, productVariantId: item.productVariantId, quantity },
        });
      }
      await tx.cart.delete({ where: { id: anon.id } });
    });
    res.clearCookie(CART_COOKIE, { path: '/' });
  }

  async clear(cartId: string, tx: Tx): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cartId } });
  }
}
