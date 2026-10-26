'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError, cartChanged, type CartView } from '@/lib/api';
import { bnDigits, taka } from '@/lib/format';
import type { ProductDetail } from './page';

type Variant = ProductDetail['variants'][number];

/** Variant + quantity + add. Re-checks availability for the visitor's chosen area. */
export function AddToCart({ slug, variants: initial }: { slug: string; variants: Variant[] }) {
  const [variants, setVariants] = useState(initial);
  const [areaChecked, setAreaChecked] = useState(false);
  const [selected, setSelected] = useState(initial.find((v) => v.availability === 'IN_STOCK')?.id ?? initial[0]?.id);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<CartView>('/cart')
      .then(async (cart) => {
        if (!cart.areaId) return;
        const fresh = await api<ProductDetail & { areaChecked: boolean }>(`/catalog/products/${slug}?areaId=${cart.areaId}`);
        setVariants(fresh.variants);
        setAreaChecked(true);
      })
      .catch(() => undefined);
  }, [slug]);

  const v = variants.find((x) => x.id === selected);
  const max = Math.max(0, Math.min(99, v?.maxQty ?? 0));
  const available = v?.availability === 'IN_STOCK';

  const add = async () => {
    if (!v) return;
    setBusy(true);
    setMsg(null);
    try {
      const cart = await api<CartView>('/cart');
      const existing = cart.lines.find((l) => l.variantId === v.id)?.quantity ?? 0;
      await api(`/cart/items/${v.id}`, { method: 'PUT', body: { quantity: existing + qty } });
      cartChanged();
      setMsg({ ok: true, text: 'কার্টে যোগ হয়েছে' });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'যোগ করা যায়নি' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <fieldset>
        <legend className="label">পরিমাণ / ধরন</legend>
        <div className="flex flex-wrap gap-2">
          {variants.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={x.id === selected}
              onClick={() => {
                setSelected(x.id);
                setQty(1);
              }}
              className={`btn ${x.id === selected ? 'btn-primary' : 'btn-ghost'} ${x.availability === 'OUT_OF_STOCK' ? 'line-through decoration-2' : ''}`}
            >
              {x.labelBn}
              {x.availability === 'OUT_OF_STOCK' && <span className="sr-only"> (স্টকে নেই)</span>}
            </button>
          ))}
        </div>
      </fieldset>
      {v && (
        <p className="mt-4 text-3xl font-bold text-brand-700">
          {taka(v.pricePoisha)}
          {v.compareAtPoisha && <span className="ml-2 text-base font-normal text-muted line-through">{taka(v.compareAtPoisha)}</span>}
        </p>
      )}
      <p className={`mt-1 text-sm font-semibold ${available ? 'text-success' : 'text-danger'}`}>
        {available ? (areaChecked ? 'আপনার এলাকায় পাওয়া যাচ্ছে' : 'স্টকে আছে') : areaChecked ? 'আপনার এলাকায় এখন পাওয়া যাচ্ছে না' : 'স্টকে নেই'}
      </p>
      {!areaChecked && <p className="text-xs text-muted">ডেলিভারি এলাকা বেছে নিলে আপনার এলাকার স্টক দেখানো হবে।</p>}
      <div className="mt-4 flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-line bg-white" role="group" aria-label="সংখ্যা">
          <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="কমান">
            −
          </button>
          <span className="w-10 text-center font-semibold" aria-live="polite">
            {bnDigits(qty)}
          </span>
          <button type="button" className="h-11 w-11 text-xl" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="বাড়ান">
            +
          </button>
        </div>
        <button type="button" className="btn btn-primary flex-1" onClick={() => void add()} disabled={!available || busy || qty > max}>
          {busy ? 'যোগ হচ্ছে…' : 'কার্টে যোগ করুন'}
        </button>
      </div>
      {msg && (
        <p role="status" className={`mt-3 rounded-lg p-3 text-sm ${msg.ok ? 'bg-accent-100 text-brand-700' : 'bg-red-50 text-danger'}`}>
          {msg.text}
          {msg.ok && (
            <Link href="/cart" className="ml-2 font-semibold underline">
              কার্ট দেখুন
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
