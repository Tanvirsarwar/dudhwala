'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, cartChanged, type Area, type CartView } from '@/lib/api';
import { bnDigits, dayLabel, dhakaDayKey, taka, timeLabel } from '@/lib/format';
import { OtpLogin } from '@/components/otp-login';

interface SavedAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  instructions: string | null;
  isDefault: boolean;
  area: { id: string; nameBn: string; active: boolean };
}
interface Quote {
  serviceable: boolean;
  slots: { slotKey: string; startsAt: string; endsAt: string; remaining: 'AVAILABLE' | 'FEW' }[];
  reason: string | null;
  noSingleOutlet: boolean;
  unavailableEverywhere: string[];
  blockingVariantIds: string[];
  minOrderPoisha: number | null;
}
interface Price {
  subtotalPoisha: number;
  discountPoisha: number;
  deliveryFeePoisha: number;
  totalPoisha: number;
  codEligible: boolean;
  paymentMethods: ('ONLINE' | 'COD')[];
  quoteHash: string;
}

const POLICY_VERSION = '2026-10';
const REASONS: Record<string, string> = {
  AREA_NOT_SERVICEABLE: 'এই এলাকায় এখনো ডেলিভারি দেওয়া হয় না।',
  NO_SINGLE_OUTLET: 'এই সব পণ্য একসাথে একটি আউটলেট থেকে পাঠানো সম্ভব নয়। কিছু পণ্য সরিয়ে আবার চেষ্টা করুন।',
  MIN_ORDER_NOT_MET: 'ন্যূনতম অর্ডারের পরিমাণ পূরণ হয়নি।',
  OUT_OF_STOCK: 'কিছু পণ্য এই এলাকায় স্টকে নেই।',
  NO_SLOTS: 'এই মুহূর্তে কোনো ডেলিভারি সময় খালি নেই। পরে আবার চেষ্টা করুন।',
};

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-key`);

export default function CheckoutPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [cart, setCart] = useState<CartView | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [saved, setSaved] = useState<SavedAddress[]>([]);
  const [addressId, setAddressId] = useState<string>('new');
  const [form, setForm] = useState({ recipientName: '', phone: '', areaId: '', line1: '', line2: '', landmark: '', instructions: '' });
  const [saveAddress, setSaveAddress] = useState(true);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [slotKey, setSlotKey] = useState<string | null>(null);
  const [method, setMethod] = useState<'COD' | 'ONLINE'>('COD');
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(newKey);

  const boot = useCallback(async () => {
    try {
      await api('/me');
      setAuthed(true);
    } catch {
      setAuthed(false);
      return;
    }
    const [c, a, s] = await Promise.all([api<CartView>('/cart'), api<Area[]>('/delivery/areas'), api<SavedAddress[]>('/me/addresses')]);
    setCart(c);
    setAreas(a);
    setSaved(s);
    const def = s.find((x) => x.isDefault && x.area.active) ?? s.find((x) => x.area.active);
    if (def) setAddressId(def.id);
    else if (c.areaId) setForm((f) => ({ ...f, areaId: c.areaId ?? '' }));
  }, []);
  useEffect(() => void boot(), [boot]);

  const chosen = saved.find((s) => s.id === addressId);
  const areaId = chosen ? chosen.area.id : form.areaId;
  const shipAddress = useMemo(
    () =>
      chosen
        ? { recipientName: chosen.recipientName, phone: chosen.phone, areaId: chosen.area.id, line1: chosen.line1, line2: chosen.line2, landmark: chosen.landmark, instructions: chosen.instructions }
        : { ...form, line2: form.line2 || null, landmark: form.landmark || null, instructions: form.instructions || null },
    [chosen, form],
  );

  // Area → delivery slots (server decides serviceability and outlet; outlet identity is not shown).
  useEffect(() => {
    setQuote(null);
    setSlotKey(null);
    setPrice(null);
    if (!areaId || !authed) return;
    api<Quote>('/checkout/quote', { method: 'POST', body: { areaId } })
      .then((q) => {
        setQuote(q);
        setSlotKey(q.slots[0]?.slotKey ?? null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'ডেলিভারি সময় লোড করা যায়নি'));
  }, [areaId, authed]);

  const reprice = useCallback(async () => {
    if (!areaId || !slotKey) return;
    try {
      const p = await api<Price>('/checkout/price', { method: 'POST', body: { areaId, slotKey, paymentMethod: method, couponCode: appliedCoupon } });
      setPrice(p);
      if (!p.paymentMethods.includes(method) && p.paymentMethods[0]) setMethod(p.paymentMethods[0]);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'COUPON_INVALID') {
        setAppliedCoupon(null);
        setError(e.message);
      } else setError(e instanceof ApiError ? e.message : 'দাম হিসাব করা যায়নি');
    }
  }, [areaId, slotKey, method, appliedCoupon]);
  useEffect(() => void reprice(), [reprice]);

  const days = useMemo(() => {
    const groups = new Map<string, Quote['slots']>();
    for (const s of quote?.slots ?? []) {
      const k = dhakaDayKey(s.startsAt);
      groups.set(k, [...(groups.get(k) ?? []), s]);
    }
    return [...groups.values()];
  }, [quote]);

  const place = async () => {
    if (!price || !slotKey) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ orderId: string; next: 'REDIRECT' | 'CONFIRMATION' }>('/checkout/orders', {
        method: 'POST',
        headers: { 'idempotency-key': idemKey },
        body: { address: shipAddress, slotKey, paymentMethod: method, couponCode: appliedCoupon, quoteHash: price.quoteHash, acceptedPolicyVersion: POLICY_VERSION, saveAddress: !chosen && saveAddress },
      });
      cartChanged();
      if (r.next === 'REDIRECT') {
        const init = await api<{ redirectUrl: string }>(`/payments/${r.orderId}/initiate`, { method: 'POST' });
        window.location.assign(init.redirectUrl);
        return;
      }
      router.push(`/orders/${r.orderId}?placed=1`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PRICE_CHANGED') {
        await reprice();
        setError('দাম বা খরচ পরিবর্তিত হয়েছে। নতুন মোট দেখে আবার নিশ্চিত করুন।');
      } else if (e instanceof ApiError && e.code === 'SLOT_FULL') {
        setError('এই সময়টি এইমাত্র পূর্ণ হয়ে গেছে। অন্য সময় বেছে নিন।');
        const q = await api<Quote>('/checkout/quote', { method: 'POST', body: { areaId } });
        setQuote(q);
        setSlotKey(q.slots[0]?.slotKey ?? null);
      } else {
        setError(e instanceof ApiError ? e.message : 'অর্ডার করা যায়নি, আবার চেষ্টা করুন');
      }
      setIdemKey(newKey()); // a changed request needs a fresh key
    } finally {
      setBusy(false);
    }
  };

  if (authed === null) return <p className="pt-10 text-center text-muted">লোড হচ্ছে…</p>;
  if (!authed)
    return (
      <div className="mx-auto max-w-md pt-8">
        <OtpLogin title="অর্ডার করতে মোবাইল নম্বর যাচাই করুন" onDone={() => void boot()} />
        <p className="mt-3 text-center text-sm text-muted">আলাদা পাসওয়ার্ড লাগবে না। এই নম্বরেই অর্ডারের খবর পাবেন।</p>
      </div>
    );
  if (!cart) return <p className="pt-10 text-center text-muted">লোড হচ্ছে…</p>;
  if (cart.lines.length === 0)
    return (
      <div className="card mx-auto mt-8 max-w-md p-8 text-center">
        <p>কার্ট খালি।</p>
        <Link href="/" className="btn btn-primary mt-4">
          কেনাকাটা করুন
        </Link>
      </div>
    );

  const addressValid = chosen || (form.recipientName.trim() && form.phone.trim().length >= 10 && form.areaId && form.line1.trim().length >= 3);
  const canPlace = Boolean(addressValid && price && slotKey && accepted && price.paymentMethods.includes(method) && !busy);
  const blocking = new Set(quote?.blockingVariantIds ?? []);

  return (
    <div className="grid gap-6 pt-6 md:grid-cols-[1fr_340px]">
      <div className="grid gap-5">
        <h1 className="text-2xl font-bold">চেকআউট</h1>

        <section className="card p-5" aria-labelledby="s-addr">
          <h2 id="s-addr" className="text-lg font-bold">
            ১. ডেলিভারি ঠিকানা
          </h2>
          {saved.length > 0 && (
            <div className="mt-3 grid gap-2" role="radiogroup" aria-label="সংরক্ষিত ঠিকানা">
              {saved.map((s) => (
                <label key={s.id} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${addressId === s.id ? 'border-brand-600 bg-brand-100' : 'border-line'} ${s.area.active ? '' : 'opacity-50'}`}>
                  <input type="radio" name="addr" checked={addressId === s.id} disabled={!s.area.active} onChange={() => setAddressId(s.id)} />
                  <span>
                    <strong>{s.label ?? s.recipientName}</strong> — {s.line1}, {s.area.nameBn}
                    {!s.area.active && <span className="block text-sm text-danger">এই এলাকায় এখন ডেলিভারি হয় না</span>}
                  </span>
                </label>
              ))}
              <label className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${addressId === 'new' ? 'border-brand-600 bg-brand-100' : 'border-line'}`}>
                <input type="radio" name="addr" checked={addressId === 'new'} onChange={() => setAddressId('new')} />
                নতুন ঠিকানা
              </label>
            </div>
          )}
          {addressId === 'new' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="f-name">
                  প্রাপকের নাম
                </label>
                <input id="f-name" className="field" autoComplete="name" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="f-phone">
                  মোবাইল
                </label>
                <input id="f-phone" className="field" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="f-area">
                  এলাকা
                </label>
                <select id="f-area" className="field" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                  <option value="">এলাকা বেছে নিন</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nameBn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="f-line1">
                  বাসা / রাস্তা
                </label>
                <input id="f-line1" className="field" autoComplete="address-line1" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="f-landmark">
                  পরিচিত স্থান (ঐচ্ছিক)
                </label>
                <input id="f-landmark" className="field" value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
              </div>
              <div>
                <label className="label" htmlFor="f-line2">
                  ফ্ল্যাট / তলা (ঐচ্ছিক)
                </label>
                <input id="f-line2" className="field" autoComplete="address-line2" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label" htmlFor="f-instr">
                  ডেলিভারি নির্দেশনা (ঐচ্ছিক)
                </label>
                <input id="f-instr" className="field" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} /> এই ঠিকানা সংরক্ষণ করুন
              </label>
            </div>
          )}
        </section>

        <section className="card p-5" aria-labelledby="s-slot">
          <h2 id="s-slot" className="text-lg font-bold">
            ২. ডেলিভারির সময়
          </h2>
          {!areaId && <p className="mt-2 text-muted">আগে এলাকা বেছে নিন।</p>}
          {areaId && !quote && <p className="mt-2 text-muted">খোঁজা হচ্ছে…</p>}
          {quote && quote.slots.length === 0 && (
            <div className="mt-3 rounded-lg bg-red-50 p-3 text-danger" role="alert">
              {REASONS[quote.reason ?? 'NO_SLOTS']}
              {quote.minOrderPoisha !== null && quote.reason === 'MIN_ORDER_NOT_MET' && <span> ন্যূনতম: {taka(quote.minOrderPoisha)}</span>}
              {blocking.size > 0 && (
                <ul className="mt-2 list-inside list-disc text-sm">
                  {cart.lines
                    .filter((l) => blocking.has(l.variantId) || quote.unavailableEverywhere.includes(l.variantId))
                    .map((l) => (
                      <li key={l.variantId}>
                        {l.nameBn} ({l.labelBn})
                      </li>
                    ))}
                </ul>
              )}
              <Link href="/cart" className="mt-2 inline-block underline">
                কার্ট পরিবর্তন করুন
              </Link>
            </div>
          )}
          {days.map((slots) => (
            <fieldset key={slots[0]!.startsAt} className="mt-3">
              <legend className="font-semibold">{dayLabel(slots[0]!.startsAt)}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {slots.map((s) => (
                  <label key={s.slotKey} className={`cursor-pointer rounded-xl border px-3 py-2 ${slotKey === s.slotKey ? 'border-brand-600 bg-brand-100' : 'border-line bg-white'}`}>
                    <input type="radio" name="slot" className="sr-only" checked={slotKey === s.slotKey} onChange={() => setSlotKey(s.slotKey)} />
                    {timeLabel(s.startsAt)} – {timeLabel(s.endsAt)}
                    {s.remaining === 'FEW' && <span className="ml-1 text-xs text-warning">(অল্প খালি)</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </section>

        <section className="card p-5" aria-labelledby="s-pay">
          <h2 id="s-pay" className="text-lg font-bold">
            ৩. পেমেন্ট
          </h2>
          <div className="mt-3 grid gap-2" role="radiogroup" aria-label="পেমেন্ট পদ্ধতি">
            {(['COD', 'ONLINE'] as const).map((m) => {
              const ok = price?.paymentMethods.includes(m) ?? false;
              return (
                <label key={m} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${method === m ? 'border-brand-600 bg-brand-100' : 'border-line'} ${ok ? '' : 'cursor-not-allowed opacity-50'}`}>
                  <input type="radio" name="method" checked={method === m} disabled={!ok} onChange={() => setMethod(m)} />
                  <span>
                    <strong>{m === 'COD' ? 'ক্যাশ অন ডেলিভারি' : 'অনলাইন পেমেন্ট'}</strong>
                    <span className="block text-sm text-muted">{m === 'COD' ? 'পণ্য হাতে পেয়ে টাকা দিন' : 'কার্ড / মোবাইল ব্যাংকিং — নিরাপদ পেমেন্ট পেজে'}</span>
                    {!ok && price && <span className="block text-sm text-danger">এই অর্ডারে পাওয়া যাচ্ছে না</span>}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex gap-2">
            <label htmlFor="coupon" className="sr-only">
              কুপন কোড
            </label>
            <input id="coupon" className="field" placeholder="কুপন কোড (থাকলে)" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
            <button type="button" className="btn btn-ghost" disabled={!coupon.trim()} onClick={() => setAppliedCoupon(coupon.trim().toUpperCase())}>
              প্রয়োগ
            </button>
          </div>
          {appliedCoupon && price && price.discountPoisha > 0 && <p className="mt-2 text-sm text-success">কুপন {appliedCoupon} প্রয়োগ হয়েছে</p>}
        </section>
      </div>

      <aside className="card h-fit p-5 md:sticky md:top-32" aria-labelledby="s-sum">
        <h2 id="s-sum" className="text-lg font-bold">
          অর্ডার সারাংশ
        </h2>
        <ul className="mt-3 grid gap-1 text-sm">
          {cart.lines.map((l) => (
            <li key={l.variantId} className="flex justify-between gap-2">
              <span>
                {l.nameBn} × {bnDigits(l.quantity)}
              </span>
              <span>{taka(l.lineTotalPoisha)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 grid gap-1 border-t border-line pt-3">
          <div className="flex justify-between">
            <dt>সাবটোটাল</dt>
            <dd>{taka(price?.subtotalPoisha ?? cart.subtotalPoisha)}</dd>
          </div>
          {price && price.discountPoisha > 0 && (
            <div className="flex justify-between text-success">
              <dt>ছাড়</dt>
              <dd>−{taka(price.discountPoisha)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt>ডেলিভারি চার্জ</dt>
            <dd>{price ? (price.deliveryFeePoisha === 0 ? 'ফ্রি' : taka(price.deliveryFeePoisha)) : '—'}</dd>
          </div>
          <div className="flex justify-between border-t border-line pt-2 text-lg font-bold">
            <dt>মোট</dt>
            <dd aria-live="polite">{price ? taka(price.totalPoisha) : '—'}</dd>
          </div>
        </dl>
        <label className="mt-4 flex gap-2 text-sm">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          <span>
            আমি{' '}
            <Link href="/pages/terms" className="underline" target="_blank">
              শর্তাবলী
            </Link>{' '}
            ও{' '}
            <Link href="/pages/refund-policy" className="underline" target="_blank">
              রিফান্ড নীতি
            </Link>{' '}
            মেনে নিচ্ছি
          </span>
        </label>
        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-primary mt-4 w-full" disabled={!canPlace} onClick={() => void place()}>
          {busy ? 'অর্ডার হচ্ছে…' : method === 'ONLINE' ? 'পেমেন্ট করুন' : 'অর্ডার নিশ্চিত করুন'}
        </button>
      </aside>
    </div>
  );
}
