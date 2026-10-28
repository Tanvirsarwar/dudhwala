'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, cartChanged, type CartView } from '@/lib/api';
import { bnDigits, taka } from '@/lib/format';
import { ProductImage } from '@/components/product-image';
import { bulkStatus } from '@dudhwala/shared';
import { useConfig } from '@/lib/demo/config';
import { DEMO_ORDERING, useEligibility, useZone } from '@/lib/demo/zone';

export default function CartPage() {
  const [cart, setCart] = useState<CartView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    api<CartView>('/cart').then(setCart).catch(() => setError('কার্ট লোড করা যায়নি'));
  }, []);
  useEffect(load, [load]);
  const eligible = useEligibility();
  const cfg = useConfig();
  const { setZone } = useZone();

  const setQty = async (variantId: string, quantity: number) => {
    setError(null);
    try {
      setCart(await api<CartView>(`/cart/items/${variantId}`, { method: 'PUT', body: { quantity } }));
      cartChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'পরিবর্তন করা যায়নি');
    }
  };

  if (!cart)
    return error ? (
      <div className="notice notice-err mx-auto mt-10 max-w-md text-center" role="alert">
        <p>{error}</p>
        <button type="button" className="btn btn-ghost btn-compact mt-2" onClick={load}>
          আবার চেষ্টা করুন
        </button>
      </div>
    ) : (
      <div className="mx-auto mt-6 max-w-5xl" aria-busy="true" aria-label="লোড হচ্ছে…">
        <div className="skeleton h-8 w-40 rounded-lg" />
        <div className="skeleton mt-4 h-28 rounded-2xl" />
      </div>
    );
  // Zone revalidation (demo): lines that cannot go to the chosen zone are flagged, never silently removed, and block checkout.
  const ineligible = new Set(cart.lines.filter((l) => !eligible({ categorySlug: l.categorySlug ?? '', outerCityStatus: l.outerCityStatus }).eligible).map((l) => l.variantId));
  const blocked = cart.lines.some((l) => !l.available) || ineligible.size > 0;
  const bulk = DEMO_ORDERING ? bulkStatus(cart.lines.map((l) => ({ quantity: l.quantity, linePoisha: l.lineTotalPoisha })), cfg.bulk) : null;

  return (
    <div className="mx-auto max-w-5xl pt-6">
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
          <div className="grid content-start gap-3">
          {DEMO_ORDERING && ineligible.size > 0 && (
            <div className="notice notice-err" role="alert">
              <p className="font-semibold">
                <b>{bnDigits(ineligible.size)}</b>
                <span>টি পণ্য আউটার সিটিতে ডেলিভারি করা যায় না।</span> <span>এগুলো কার্টে চিহ্নিত আছে।</span>
              </p>
              <p className="mt-1 text-sm">
                <span>চেকআউটের আগে জোন বদলান অথবা এই পণ্যগুলো সরান।</span> <span>কিছু নিজে থেকে সরানো হবে না।</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary btn-compact" onClick={() => setZone('IN_CITY')}>
                  ইন সিটি বেছে নিন
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-compact"
                  onClick={() => {
                    void Promise.all(cart.lines.filter((l) => ineligible.has(l.variantId)).map((l) => setQty(l.variantId, 0)));
                  }}
                >
                  চিহ্নিত পণ্যগুলো সরান
                </button>
              </div>
            </div>
          )}
          {bulk?.isBulk && (
            <p className="notice notice-info" role="note">
              <b>বাল্ক অর্ডার।</b> <span>এই কার্ট বাল্ক অর্ডারের আওতায় পড়ে। হোম ডেলিভারি ও এক্সপ্রেস পিকআপ নেই; শুধু মদিনা মার্কেট শাখা থেকে সংগ্রহ করা যাবে, আগে পেমেন্ট (ডেমো/সিমুলেটেড) লাগবে।</span>
            </p>
          )}
          <ul className="grid gap-3">
            {cart.lines.map((l) => (
              <li key={l.variantId} className="card flex gap-3 p-3">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-lg">
                  <ProductImage src={l.image} alt={l.nameBn} category={l.categorySlug ?? ''} />
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/p/${l.productSlug}`} className="font-semibold hover:underline">
                    {l.nameBn}
                  </Link>
                  <p className="text-sm text-muted">
                    {l.labelBn ? `${l.labelBn} · ` : ''}
                    {taka(l.unitPricePoisha)}
                  </p>
                  {ineligible.has(l.variantId) && (
                    <p className="mt-1">
                      <span className="badge-ineligible">আউটার সিটিতে ডেলিভারি হয় না</span>
                    </p>
                  )}
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
                <p className={l.lineTotalPoisha === null ? 'price-pending' : 'font-bold'}>{taka(l.lineTotalPoisha)}</p>
              </li>
            ))}
          </ul>
          </div>
          <aside className="card h-fit p-5">
            <div className="flex justify-between">
              <span>সাবটোটাল</span>
              <strong>{taka(cart.subtotalPoisha)}</strong>
            </div>
            <p className="mt-1 text-sm text-muted">{DEMO_ORDERING ? 'ডেমো অর্ডার: ডেলিভারি চার্জ নেই, কোনো আসল পেমেন্ট নেই।' : 'ডেলিভারি চার্জ ও ছাড় চেকআউটে হিসাব হবে।'}</p>
            {error && (
              <p role="alert" className="mt-3 rounded-lg bg-danger-bg p-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Link href="/checkout" aria-disabled={blocked} className={`btn btn-primary mt-4 w-full ${blocked ? 'pointer-events-none opacity-50' : ''}`}>
              চেকআউট
            </Link>
            {blocked && <p className="mt-2 text-sm text-danger">{ineligible.size > 0 ? 'চিহ্নিত পণ্যগুলো ঠিক করে নিন।' : 'অপ্রাপ্য পণ্যগুলো ঠিক করে নিন।'}</p>}
            {DEMO_ORDERING && bulk && (
              <p className="mt-3 text-xs text-muted">
                <span>{cfg.isPlaceholder ? 'বাল্ক অর্ডারের সীমা (ডেমো, চূড়ান্ত নয়):' : 'বাল্ক অর্ডারের সীমা:'}</span> <b>{bnDigits(cfg.bulk.minTotalQuantity)}</b> <span>টি বা তার বেশি।</span>
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
