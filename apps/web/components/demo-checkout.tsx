'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  availableFulfilments, bulkStatus, BULK_CONFIG, earliestPickup, orderingStatus, pickupSlots, validateCheckout, zonedParts,
  type DemoPaymentState, type FulfilmentMethod,
} from '@dudhwala/shared';
import { api, ApiError, cartChanged, type CartView } from '@/lib/api';
import { bnDigits, dayLabel, taka, timeLabel } from '@/lib/format';
import { ISSUE_MESSAGES, METHOD_LABEL } from '@/lib/demo/messages';
import { useZone } from '@/lib/demo/zone';
import { orderService, outletService, type DemoOrder, type Outlet } from '@/lib/services';
import { DemoOrderCard } from './demo-order-card';
import { ETA_TEXT, useNow } from './zone-bar';

const BLANK = { name: '', phone: '', line1: '', landmark: '' };

/**
 * DEMO checkout (no OTP login, no real payment, no card form). Validation uses the shared rules in
 * @dudhwala/shared/ordering; they run in the browser here, so they are NOT security enforcement.
 */
export function DemoCheckout() {
  const { zone } = useZone();
  const now = useNow();
  const [cart, setCart] = useState<CartView | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [choice, setChoice] = useState<FulfilmentMethod>('HOME_DELIVERY');
  const [form, setForm] = useState(BLANK);
  const [outletId, setOutletId] = useState('');
  const [pickupIso, setPickupIso] = useState('');
  const [paid, setPaid] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<DemoOrder | null>(null);

  useEffect(() => {
    api<CartView>('/cart').then(setCart).catch(() => setError('কার্ট লোড করা যায়নি'));
    outletService.list().then(setOutlets).catch(() => setOutlets([]));
  }, []);

  const lines = useMemo(() => cart?.lines ?? [], [cart]);
  const bulk = useMemo(() => bulkStatus(lines.map((l) => ({ quantity: l.quantity, linePoisha: l.lineTotalPoisha }))), [lines]);
  const methods = availableFulfilments(bulk.isBulk);
  const method: FulfilmentMethod = methods.includes(choice) ? choice : (methods[0] ?? 'HOME_DELIVERY');
  const clock = now ?? new Date(0);
  const minute = Math.floor(clock.getTime() / 60_000);
  const slots = useMemo(() => (now ? pickupSlots(new Date(minute * 60_000), 12) : []), [now, minute]);
  const pickupAt = slots.find((s) => s.toISOString() === pickupIso) ?? slots[0] ?? null;
  const outlet = outlets.find((o) => o.id === outletId) ?? null;
  const payment: DemoPaymentState = method === 'BULK_ORDER' ? (paid ? 'DEMO_PAID_SIMULATED' : 'DEMO_UNPAID') : 'NOT_REQUIRED_DEMO';

  const issues = useMemo(
    () =>
      validateCheckout({
        now: clock,
        method,
        zone,
        lines: lines.map((l) => ({ key: l.variantId, product: { categorySlug: l.categorySlug ?? '', outerCityStatus: l.outerCityStatus }, quantity: l.quantity, linePoisha: l.lineTotalPoisha })),
        address: { name: form.name, phone: form.phone, line1: form.line1 },
        outletId: outlet?.id ?? null,
        pickupAt,
        payment,
      }),
    [clock, method, zone, lines, form, outlet, pickupAt, payment],
  );
  const status = orderingStatus(clock);

  const place = useCallback(() => {
    setTried(true);
    if (!now || !cart || issues.length > 0) return;
    const res = orderService.place({
      now: new Date(),
      method,
      zone: method === 'HOME_DELIVERY' ? zone : null,
      lines: lines.map((l) => ({ key: l.variantId, productSlug: l.productSlug, nameBn: l.nameBn, nameEn: l.nameEn, quantity: l.quantity, unitPricePoisha: l.unitPricePoisha, linePoisha: l.lineTotalPoisha, categorySlug: l.categorySlug ?? '', outerCityStatus: l.outerCityStatus })),
      ...(method === 'HOME_DELIVERY' ? { address: form } : {}),
      outlet,
      pickupAt,
      payment,
    });
    if (!res.ok) return; // issues are recomputed live and shown
    setPlaced(res.order);
    void Promise.all(lines.map((l) => api(`/cart/items/${l.variantId}`, { method: 'PUT', body: { quantity: 0 } }).catch((e: unknown) => (e instanceof ApiError ? null : null)))).then(cartChanged);
  }, [now, cart, issues, method, zone, lines, form, outlet, pickupAt, payment]);

  if (placed)
    return (
      <div className="mx-auto max-w-3xl pt-6">
        <p className="notice notice-ok" role="status">
          <b>অর্ডার সংরক্ষিত হয়েছে।</b> <span>এটি আসল অর্ডার নয় এবং কোনো আসল পেমেন্ট হয়নি।</span>
        </p>
        <div className="mt-3">
          <DemoOrderCard order={placed} onAdvance={(id) => { const o = orderService.advance(id); if (o) setPlaced({ ...o }); }} />
        </div>
        <Link href="/" className="btn btn-primary mt-4">
          কেনাকাটা চালিয়ে যান
        </Link>
      </div>
    );
  if (!cart) return <p className="pt-10 text-center text-muted">{error ?? 'লোড হচ্ছে…'}</p>;
  if (lines.length === 0)
    return (
      <div className="card mx-auto mt-6 max-w-3xl p-8 text-center">
        <p className="text-muted">কার্ট খালি।</p>
        <Link href="/" className="btn btn-primary mt-4">
          কেনাকাটা শুরু করুন
        </Link>
      </div>
    );

  const field = (id: 'name' | 'phone' | 'line1' | 'landmark', label: string, autoComplete: string, inputMode?: 'tel') => (
    <div>
      <label className="label" htmlFor={`dc-${id}`}>
        {label}
      </label>
      <input id={`dc-${id}`} className="field" autoComplete={autoComplete} inputMode={inputMode} value={form[id]} onChange={(e) => setForm({ ...form, [id]: e.target.value })} />
    </div>
  );
  const lineIssues = issues.filter((i) => i.line);
  const otherIssues = issues.filter((i) => !i.line && i.code !== 'ordering_closed');
  const nameOf = (key?: string) => lines.find((l) => l.variantId === key)?.nameBn ?? '';

  return (
    <div className="mx-auto max-w-5xl pt-6">
      <h1 className="text-2xl font-bold">চেকআউট</h1>
      <p className="notice notice-info mt-2">
        <b>ডেমো চেকআউট।</b> <span>কোনো আসল পেমেন্ট, কার্ড বা এসএমএস নেই।</span> <span>অর্ডার শুধু এই ব্রাউজারে সংরক্ষিত হয়।</span>
      </p>
      {now && !status.open && (
        <div className="notice notice-err mt-3" role="alert">
          <p className="font-semibold">{ISSUE_MESSAGES.ordering_closed}</p>
          <p className="text-sm">অর্ডার নেওয়া হয় প্রতিদিন সকাল ১০:০০ থেকে সন্ধ্যা ১০:০০ পর্যন্ত (ঢাকার সময়)।</p>
          <p className="text-sm">
            <span>আবার খুলবে:</span> {status.reopensAt && zonedParts(status.reopensAt).d !== zonedParts(clock).d && <span>আগামীকাল</span>} <span>{status.reopensAt ? timeLabel(status.reopensAt) : ''}</span>
          </p>
        </div>
      )}
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_340px]">
        <div className="grid content-start gap-4">
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-lg font-bold">কীভাবে নেবেন</legend>
            {bulk.isBulk && (
              <p className="notice notice-info" role="note">
                <b>বাল্ক অর্ডার।</b> <span>আপনার কার্ট বাল্ক অর্ডারের আওতায় পড়ে, তাই হোম ডেলিভারি ও এক্সপ্রেস পিকআপ বন্ধ।</span>
              </p>
            )}
            {(['HOME_DELIVERY', 'EXPRESS_PICKUP', 'BULK_ORDER'] as const).map((m) => {
              const on = methods.includes(m);
              return (
                <label key={m} className="opt-card" aria-disabled={!on}>
                  <input type="radio" name="fulfilment" className="sr-only" checked={method === m} disabled={!on} onChange={() => setChoice(m)} />
                  <span className="font-semibold">{METHOD_LABEL[m]}</span>
                  <span className="block text-sm text-muted">
                    {m === 'HOME_DELIVERY' && <span>{ETA_TEXT[zone]}</span>}
                    {m === 'EXPRESS_PICKUP' && (
                      <>
                        <span>আউটলেট থেকে নিজে নিয়ে যান।</span> <span>ডেলিভারি নয়।</span>
                      </>
                    )}
                    {m === 'BULK_ORDER' && (
                      <>
                        <span>আগে পেমেন্ট, শুধু মদিনা মার্কেট শাখা থেকে সংগ্রহ।</span> <span>ডেলিভারি নয়।</span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>

          {method === 'HOME_DELIVERY' && (
            <section className="card grid gap-3 p-4" aria-labelledby="dc-home">
              <h2 id="dc-home" className="text-lg font-bold">
                ডেলিভারির ঠিকানা
              </h2>
              <p className="text-sm">
                <b>জোন:</b> <span>{zone === 'IN_CITY' ? 'ইন সিটি' : 'আউটার সিটি'}</span> · <span>{ETA_TEXT[zone]}</span>
              </p>
              {field('name', 'নাম', 'name')}
              {field('phone', 'মোবাইল নম্বর', 'tel', 'tel')}
              {field('line1', 'ঠিকানা', 'street-address')}
              <p className="text-sm text-muted">{zone === 'IN_CITY' ? 'সিলেট সদরের যেকোনো জায়গায় ডেলিভারি হয়। শুধু আপনার পূর্ণ ঠিকানা লিখুন।' : 'সিলেটের বাইরের যেকোনো জায়গায় ডেলিভারি হয়। উপজেলা/জেলাসহ পূর্ণ ঠিকানা লিখুন।'}</p>
              {field('landmark', 'চেনার মতো স্থান (ঐচ্ছিক)', 'off')}
              <p className="text-sm text-muted">পেমেন্ট: ক্যাশ অন ডেলিভারি (ডেমো — কোনো আসল পেমেন্ট নেই)।</p>
            </section>
          )}

          {method === 'EXPRESS_PICKUP' && (
            <section className="card grid gap-3 p-4" aria-labelledby="dc-pick">
              <h2 id="dc-pick" className="text-lg font-bold">
                এক্সপ্রেস পিকআপ
              </h2>
              <p className="notice notice-warn">
                <span>এটি পিকআপ, ডেলিভারি নয়।</span> <span>আউটলেট অর্ডার "প্রস্তুত" না করা পর্যন্ত পিকআপ নিশ্চিত হয় না।</span>
              </p>
              <div>
                <label className="label" htmlFor="dc-outlet">
                  আউটলেট
                </label>
                <select id="dc-outlet" className="field" value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                  <option value="">বেছে নিন</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nameBn}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm">
                <b>সবচেয়ে আগে পিকআপ:</b> <span>{dayLabel(earliestPickup(clock))}</span> <span>{timeLabel(earliestPickup(clock))}</span>
              </p>
              <p className="text-sm text-muted">অর্ডার ও পিকআপের মধ্যে কমপক্ষে ১ ঘণ্টা সময় লাগে।</p>
              <div>
                <label className="label" htmlFor="dc-time">
                  পিকআপের সময়
                </label>
                <select id="dc-time" className="field" value={pickupAt?.toISOString() ?? ''} onChange={(e) => setPickupIso(e.target.value)}>
                  {slots.map((s) => (
                    <option key={s.toISOString()} value={s.toISOString()}>
                      {`${dayLabel(s)} · ${timeLabel(s)}`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-muted">পেমেন্ট: আউটলেটে (ডেমো — কোনো আসল পেমেন্ট নেই)।</p>
            </section>
          )}

          {method === 'BULK_ORDER' && (
            <section className="card grid gap-3 p-4" aria-labelledby="dc-bulk">
              <h2 id="dc-bulk" className="text-lg font-bold">
                বাল্ক অর্ডার
              </h2>
              <p>
                <b>সংগ্রহের স্থান:</b> <span>{BULK_CONFIG.collectionBranch.nameBn}</span>
              </p>
              <p className="text-sm text-muted">হোম ডেলিভারি ও তাৎক্ষণিক ডেলিভারি নেই।</p>
              <div className="notice notice-warn">
                <b>ডেমো/সিমুলেটেড পেমেন্ট</b>
                <p className="text-sm">বাল্ক অর্ডারে আগে পেমেন্ট লাগে। এখানে কোনো আসল টাকা কাটা হয় না।</p>
                <button type="button" className={`btn btn-compact mt-2 ${paid ? 'btn-accent' : 'btn-primary'}`} aria-pressed={paid} onClick={() => setPaid(true)}>
                  {paid ? '✓ সিমুলেটেড পেমেন্ট সম্পন্ন' : 'সিমুলেটেড পেমেন্ট করুন'}
                </button>
              </div>
            </section>
          )}
        </div>

        <aside className="card h-fit p-5">
          <h2 className="text-lg font-bold">অর্ডারের সারাংশ</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {lines.map((l) => (
              <li key={l.variantId} className="flex justify-between gap-2">
                <span>
                  {l.nameBn} × {bnDigits(l.quantity)}
                </span>
                <span className={l.lineTotalPoisha === null ? 'price-pending' : ''}>{taka(l.lineTotalPoisha)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex justify-between border-t border-line pt-2 font-bold">
            <span>মোট</span>
            <span className={cart.subtotalPoisha === null ? 'price-pending' : ''}>{taka(cart.subtotalPoisha)}</span>
          </p>
          {bulk.isBulk && (
            <p className="mt-2 text-xs text-muted">
              <span>বাল্ক অর্ডারের সীমা (ডেমো, চূড়ান্ত নয়):</span> <b>{bnDigits(BULK_CONFIG.minTotalQuantity)}</b> <span>টি বা তার বেশি।</span>
            </p>
          )}
          {tried && (lineIssues.length > 0 || otherIssues.length > 0) && (
            <div className="notice notice-err mt-3" role="alert">
              <ul className="grid gap-1 text-sm">
                {lineIssues.map((i) => (
                  <li key={`${i.code}-${i.line}`}>
                    <b>{nameOf(i.line)}:</b> <span>{ISSUE_MESSAGES[i.code]}</span>
                  </li>
                ))}
                {otherIssues.map((i) => (
                  <li key={i.code}>{ISSUE_MESSAGES[i.code]}</li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="btn btn-primary mt-4 w-full" onClick={place} aria-disabled={!status.open || undefined} disabled={now !== null && !status.open}>
            অর্ডার দিন
          </button>
          <p className="mt-2 text-xs text-muted">এই যাচাই শুধু ডেমোর জন্য, নিরাপত্তা নিশ্চয়তা নয়।</p>
        </aside>
      </div>
    </div>
  );
}
