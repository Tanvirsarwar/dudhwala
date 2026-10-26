'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, cartChanged, type CartView } from '@/lib/api';
import { bnDigits, taka } from '@/lib/format';
import { ProductImage } from '@/components/product-image';

export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<CartView>('/cart').then(setCart).catch(() => setError('কার্ট লোড করা যায়নি'));
  }, []);
  useEffect(load, [load]);

  const setQty = async (variantId: string, quantity: number) => {
    setError(null);
    try {
      setCart(await api<CartView>(`/cart/items/${variantId}`, { method: 'PUT', body: { quantity } }));
      cartChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'পরিবর্তন করা যায়নি');
    }
  };

  if (!cart) return <p className="pt-10 text-center text-muted">লোড হচ্ছে…</p>;
  const blocked = cart.lines.some((l) => !l.available);

  return (
    <div className="pt-6">
      <h1 className="mb-4 text-2xl font-bold">আপনার কার্ট</h1>
      {cart.lines.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-muted">কার্ট খালি।</p>
          <Link href="/" className="btn btn-primary mt-4">
            কেনাকাটা শুরু করুন
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[1fr_320px]">
          <ul className="grid gap-3">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="card flex gap-3 p-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg">
                  <ProductImage src={l.image} alt={l.nameBn} />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${l.productSlug}`} className="font-semibold hover:underline">
                    {l.nameBn}
                  </Link>
                  <p className="text-sm text-muted">
                    {l.labelBn} · {taka(l.unitPricePoisha)}
                  </p>
                  {!l.available && (
                    <p className="mt-1 text-sm font-semibold text-danger" role="alert">
                      {l.maxQty > 0 ? `এখন সর্বোচ্চ ${bnDigits(l.maxQty)}টি পাওয়া যাবে` : 'এই পণ্যটি এখন পাওয়া যাচ্ছে না — সরিয়ে দিন'}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex items-center rounded-lg border border-line" role="group" aria-label={`${l.nameBn} সংখ্যা`}>
                      <button className="h-9 w-9" aria-label="কমান" onClick={() => void setQty(l.variantId, l.quantity - 1)}>
                        −
                      </button>
                      <span className="w-8 text-center">{bnDigits(l.quantity)}</span>
                      <button className="h-9 w-9" aria-label="বাড়ান" disabled={l.quantity >= l.maxQty} onClick={() => void setQty(l.variantId, l.quantity + 1)}>
                        +
                      </button>
                    </div>
                    <button className="text-sm text-danger underline" onClick={() => void setQty(l.variantId, 0)}>
                      সরান
                    </button>
                  </div>
                </div>
                <p className="font-bold">{taka(l.lineTotalPoisha)}</p>
              </li>
            ))}
          </ul>
          <aside className="card h-fit p-5">
            <div className="flex justify-between">
              <span>সাবটোটাল</span>
              <strong>{taka(cart.subtotalPoisha)}</strong>
            </div>
            <p className="mt-1 text-sm text-muted">ডেলিভারি চার্জ ও ছাড় চেকআউটে হিসাব হবে।</p>
            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Link href="/checkout" aria-disabled={blocked} className={`btn btn-primary mt-4 w-full ${blocked ? 'pointer-events-none opacity-50' : ''}`}>
              চেকআউট
            </Link>
            {blocked && <p className="mt-2 text-sm text-danger">অপ্রাপ্য পণ্যগুলো ঠিক করে নিন।</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
