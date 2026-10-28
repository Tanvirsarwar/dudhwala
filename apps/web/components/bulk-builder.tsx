'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bulkStatus } from '@dudhwala/shared';
import { useConfig } from '@/lib/demo/config';
import { api, cartChanged, type CartView, type Category, type ProductCardData } from '@/lib/api';
import { bnDigits, taka } from '@/lib/format';
import { makeCatalog, rank } from '@/lib/catalog-search';

const MAX = 999;

/**
 * Bulk order builder (DEMO). Quantities go into the demo cart; the demo checkout then offers Bulk Order
 * (collection from Modina Market Branch, simulated prepayment) because the quantity reaches the configured threshold.
 * The 20-item threshold is a placeholder until the shop approves real values.
 */
export function BulkBuilder({ products, categories }: { products: ProductCardData[]; categories: Category[] }) {
  const router = useRouter();
  const cfg = useConfig();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const catalog = useMemo(() => makeCatalog(products, categories), [products, categories]);
  const shown = useMemo(() => (q.trim() ? rank(catalog, q) : products), [catalog, products, q]);

  useEffect(() => {
    api<CartView>('/cart')
      .then((c) => setQty(Object.fromEntries(c.lines.map((l) => [l.variantId, l.quantity]))))
      .catch(() => undefined);
  }, []);

  const total = Object.values(qty).reduce((s, n) => s + n, 0);
  const min = cfg.bulk.minTotalQuantity;
  const byId = useMemo(() => new Map(products.map((p) => [p.variants[0]?.id ?? '', p])), [products]);
  // bulk by quantity OR by amount (the amount can only be checked once every chosen product has a price)
  const status = bulkStatus(
    Object.entries(qty).filter(([, n]) => n > 0).map(([id, n]) => { const price = byId.get(id)?.variants[0]?.pricePoisha ?? null; return { quantity: n, linePoisha: price === null ? null : price * n }; }),
    cfg.bulk,
  );
  const ready = status.isBulk;
  const vid = (p: ProductCardData) => p.variants[0]?.id ?? '';
  const set = (p: ProductCardData, n: number) => setQty((m) => ({ ...m, [vid(p)]: Math.max(0, Math.min(MAX, Math.floor(Number.isFinite(n) ? n : 0))) }));

  const go = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      const cart = await api<CartView>('/cart');
      const want = Object.entries(qty).filter(([, n]) => n > 0);
      const keep = new Set(want.map(([id]) => id));
      for (const l of cart.lines) if (!keep.has(l.variantId)) await api(`/cart/items/${l.variantId}`, { method: 'PUT', body: { quantity: 0 } });
      for (const [id, n] of want) await api(`/cart/items/${id}`, { method: 'PUT', body: { quantity: n } });
      cartChanged();
      router.push('/checkout');
    } catch {
      setError('কার্টে যোগ করা যায়নি, আবার চেষ্টা করুন');
      setBusy(false);
    }
  };

  return (
    <div className="pt-6">
      <h1 className="text-2xl font-bold">বাল্ক অর্ডার</h1>
      <p className="notice notice-info mt-2" role="note">
        <span>পণ্য বেছে সংখ্যা দিন। সংগ্রহ শুধু মদিনা মার্কেট শাখা থেকে; হোম ডেলিভারি নেই। আগে পেমেন্ট লাগে (ডেমো/সিমুলেটেড পেমেন্ট, কোনো আসল টাকা কাটা হয় না)।</span>
      </p>
      <p className="mt-2 text-sm text-muted">
        <span>{cfg.isPlaceholder ? 'ন্যূনতম (ডেমো, চূড়ান্ত নয়):' : 'ন্যূনতম:'}</span> <b>{bnDigits(min)}</b> <span>টি পণ্য।</span> <span>অথবা মোট দাম</span> <b>{taka(cfg.bulk.minTotalPoisha)}</b> <span>বা তার বেশি।</span>
      </p>
      <label htmlFor="bulk-q" className="label mt-3 block">
        খুঁজুন
      </label>
      <input id="bulk-q" className="field max-w-md" value={q} onChange={(e) => setQ(e.target.value)} placeholder="দই, সন্দেশ, কেক…" />

      {categories.map((c) => {
        const rows = shown.filter((p) => p.categorySlug === c.slug);
        if (rows.length === 0) return null;
        return (
          <section key={c.slug} className="mt-5" aria-labelledby={`bulk-${c.slug}`}>
            <h2 id={`bulk-${c.slug}`} className="mb-2 text-lg font-bold">
              {c.nameBn}
            </h2>
            <ul className="bulk-list">
              {rows.map((p) => {
                const n = qty[vid(p)] ?? 0;
                return (
                  <li key={p.id} className={`bulk-row ${n > 0 ? 'is-on' : ''}`}>
                    <span className="min-w-0 flex-1 font-semibold leading-snug">{p.nameBn}</span>
                    <div className="flex items-center rounded-lg border border-line bg-surface" role="group" aria-label={`${p.nameBn} সংখ্যা`}>
                      <button type="button" className="h-10 w-10 text-lg" aria-label="কমান" disabled={n <= 0} onClick={() => set(p, n - 1)}>
                        −
                      </button>
                      <input className="bulk-qty" inputMode="numeric" aria-label={`${p.nameBn} সংখ্যা`} value={n === 0 ? '' : String(n)} placeholder="0" onChange={(e) => set(p, Number(e.target.value.replace(/\D/g, '')))} />
                      <button type="button" className="h-10 w-10 text-lg" aria-label="বাড়ান" disabled={n >= MAX} onClick={() => set(p, n + 1)}>
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {shown.length === 0 && <p className="card mt-4 p-6 text-center">আপনার সার্চের সাথে মেলে এমন কোনো পণ্য নেই</p>}

      <div className="action-bar" role="region" aria-label="বাল্ক অর্ডারের সারাংশ">
        <p className="text-sm">
          <span>মোট:</span> <b>{bnDigits(total)}</b> <span>টি</span>
          {!ready && (
            <>
              {' · '}
              <span>আরও লাগবে:</span> <b>{bnDigits(min - total)}</b> <span>টি</span>
            </>
          )}
        </p>
        {error && (
          <span role="alert" className="text-sm text-danger">
            {error}
          </span>
        )}
        <button type="button" className="btn btn-primary" disabled={!ready || busy} aria-busy={busy} onClick={() => void go()}>
          চেকআউটে যান
        </button>
      </div>
    </div>
  );
}
