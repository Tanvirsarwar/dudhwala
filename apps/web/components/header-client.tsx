'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, type CartView } from '@/lib/api';
import { bnDigits } from '@/lib/format';
import { CartIcon } from './icons';

export function useCart() {
  const [cart, setCart] = useState<CartView | null>(null);
  const load = useCallback(() => {
    api<CartView>('/cart').then(setCart).catch(() => setCart(null));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('dw:cart', load);
    return () => window.removeEventListener('dw:cart', load);
  }, [load]);
  return { cart, reload: load };
}

export function CartButton() {
  const { cart } = useCart();
  const n = cart?.itemCount ?? 0;
  return (
    <Link href="/cart" className="relative inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-brand-500" aria-label={`কার্ট, ${bnDigits(n)}টি পণ্য`}>
      <CartIcon />
      {n > 0 && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-accent-500 px-1 text-center text-xs font-bold leading-5 text-brand-700">
          {bnDigits(n)}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {bnDigits(n)}
      </span>
    </Link>
  );
}
