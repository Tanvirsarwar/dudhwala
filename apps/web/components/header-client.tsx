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

/** Area-first browsing (APP_FLOW §1.2): the chosen area lives in the server cart. Pick a card, then confirm. */
export function AreaBar() {
  const { cart } = useCart();
  const [areas, setAreas] = useState<Area[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    api<Area[]>('/delivery/areas').then(setAreas).catch(() => setAreas([]));
  }, []);
  const current = areas.find((a) => a.id === cart?.areaId);

  const openDialog = () => {
    setPick(cart?.areaId ?? null);
    setError('');
    dialog.current?.showModal();
  };
  const confirm = async () => {
    if (!pick || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/cart/area', { method: 'PUT', body: { areaId: pick } });
      dialog.current?.close();
      cartChanged();
      window.location.reload(); // availability on the page depends on the area
    } catch {
      setError('এলাকা সংরক্ষণ করা যায়নি, আবার চেষ্টা করুন');
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-white/10 bg-[rgba(35,49,94,0.72)] text-sm backdrop-blur-md">
      <div className="page-w flex items-center gap-2 py-1.5">
        <PinIcon />
        <span>ডেলিভারি এলাকা:</span>
        <strong className="font-semibold">{current ? current.nameBn : 'বেছে নিন'}</strong>
        <button type="button" onClick={openDialog} className="ml-1 underline decoration-accent-500 underline-offset-4 hover:text-accent-100">
          {current ? 'পরিবর্তন' : 'এলাকা নির্বাচন'}
        </button>
      </div>
      <dialog ref={dialog} aria-labelledby="area-title" className="area-dialog m-auto w-[min(94vw,640px)] p-0 text-ink">
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-3">
            <span className="area-pin" aria-hidden>
              <PinIcon />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="area-title" className="text-xl font-bold leading-snug">
                আপনার ডেলিভারি এলাকা
              </h2>
              <p className="mt-0.5 text-sm text-muted">শুধু যেসব এলাকায় এখন ডেলিভারি দেওয়া হয় সেগুলো দেখানো হচ্ছে।</p>
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="area-close" aria-label="বন্ধ করুন">
              ✕
            </button>
          </div>
          {areas.length === 0 ? (
            <p className="mt-5 rounded-2xl bg-white/70 p-4 text-sm">এখনো কোনো ডেলিভারি এলাকা চালু হয়নি।</p>
          ) : (
            <ul role="radiogroup" aria-labelledby="area-title" className="mt-5 grid max-h-[52vh] gap-3 overflow-auto p-1 sm:grid-cols-2">
              {areas.map((a) => {
                const selected = pick === a.id;
                return (
                  <li key={a.id}>
                    <label className="area-card" data-selected={selected}>
                      <input type="radio" name="delivery-area" value={a.id} checked={selected} onChange={() => setPick(a.id)} className="sr-only" />
                      <span className="area-pin" aria-hidden>
                        <PinIcon />
                      </span>
                      <span className="min-w-0 flex-1 font-semibold leading-snug">{a.nameBn}</span>
                      <span className="area-check" aria-hidden>
                        ✓
                      </span>
                      {selected && <span className="sr-only">নির্বাচিত</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <button type="button" onClick={() => void confirm()} disabled={!pick || busy} aria-busy={busy} className="btn btn-confirm mt-5 w-full">
            ডেলিভারি এলাকা নিশ্চিত করুন
          </button>
        </div>
      </dialog>
    </div>
  );
}
