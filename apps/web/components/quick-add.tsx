'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, cartChanged, type CartView } from '@/lib/api';

type State = 'idle' | 'busy' | 'done' | 'error';

/** One-tap add for products with a single in-stock variant; products with options link to the detail page. */
export function QuickAdd({ slug, variantId, name }: { slug: string; variantId: string | null; name: string }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!variantId) {
    return (
      <Link href={`/p/${slug}`} className="btn btn-ghost btn-compact w-full" aria-label={`${name} — অপশন দেখুন`}>
        অপশন দেখুন
      </Link>
    );
  }

  const add = async () => {
    if (state === 'busy') return; // no double submit
    setState('busy');
    setError('');
    try {
      const cart = await api<CartView>('/cart');
      const existing = cart.lines.find((l) => l.variantId === variantId)?.quantity ?? 0;
      await api(`/cart/items/${variantId}`, { method: 'PUT', body: { quantity: existing + 1 } });
      cartChanged();
      setState('done');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'যোগ করা যায়নি');
      setState('error');
    }
    timer.current = setTimeout(() => setState('idle'), 2200);
  };

  return (
    <>
      <button type="button" onClick={() => void add()} aria-busy={state === 'busy'} className={`btn btn-compact w-full ${state === 'done' ? 'btn-accent' : 'btn-primary'}`} aria-label={`${name} — কার্টে যোগ করুন`}>
        {state === 'done' ? '✓ যোগ হয়েছে' : state === 'busy' ? 'যোগ হচ্ছে' : 'কার্টে যোগ করুন'}
      </button>
      <span role="status" className="sr-only">
        {state === 'done' ? `${name} কার্টে যোগ হয়েছে` : state === 'error' ? error : ''}
      </span>
      {state === 'error' && (
        <span aria-hidden className="toast mt-1 block text-xs text-danger">
          {error}
        </span>
      )}
    </>
  );
}
