'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, cartChanged, type Area, type CartView } from '@/lib/api';
import { bnDigits } from '@/lib/format';
import { CartIcon, PinIcon } from './icons';

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

/** Area-first browsing (APP_FLOW §1.2): the chosen area lives in the server cart. */
export function AreaBar() {
  const { cart } = useCart();
  const [areas, setAreas] = useState<Area[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    api<Area[]>('/delivery/areas').then(setAreas).catch(() => setAreas([]));
  }, []);
  const current = areas.find((a) => a.id === cart?.areaId);

  const choose = async (areaId: string) => {
    await api('/cart/area', { method: 'PUT', body: { areaId } });
    dialog.current?.close();
    cartChanged();
    window.location.reload(); // availability on the page depends on the area
  };

  return (
    <div className="border-t border-brand-500 bg-brand-700 text-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
        <PinIcon />
        <span>ডেলিভারি এলাকা:</span>
        <strong className="font-semibold">{current ? current.nameBn : 'বেছে নিন'}</strong>
        <button type="button" onClick={() => dialog.current?.showModal()} className="ml-1 underline decoration-accent-500 underline-offset-4 hover:text-accent-100">
          {current ? 'পরিবর্তন' : 'এলাকা নির্বাচন'}
        </button>
      </div>
      <dialog ref={dialog} aria-labelledby="area-title" className="m-auto w-[min(92vw,420px)] rounded-2xl p-0 text-ink backdrop:bg-black/40">
        <div className="p-5">
          <h2 id="area-title" className="text-lg font-bold">
            আপনার ডেলিভারি এলাকা
          </h2>
          <p className="mt-1 text-sm text-muted">শুধু যেসব এলাকায় এখন ডেলিভারি দেওয়া হয় সেগুলো দেখানো হচ্ছে।</p>
          {areas.length === 0 ? (
            <p className="mt-4 rounded-lg bg-milk p-3 text-sm">এখনো কোনো ডেলিভারি এলাকা চালু হয়নি।</p>
          ) : (
            <ul className="mt-4 grid max-h-72 gap-2 overflow-auto">
              {areas.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => void choose(a.id)} className={`btn btn-ghost w-full justify-start ${a.id === cart?.areaId ? 'border-brand-600 bg-brand-100' : ''}`}>
                    {a.nameBn}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => dialog.current?.close()} className="btn btn-ghost mt-4 w-full">
            বন্ধ করুন
          </button>
        </div>
      </dialog>
    </div>
  );
}
