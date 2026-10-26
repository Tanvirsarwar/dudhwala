'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { Badge, Loading, Msg, PageTitle } from '@/components/ui';

interface Setting {
  key: string;
  scope: 'GLOBAL' | 'OUTLET';
  value: unknown;
  isDefault: boolean;
  doc: string;
}

const LABEL: Record<string, string> = {
  'payments.online.enabled': 'চেকআউটে অনলাইন পেমেন্ট দেখান',
  'payments.holdMinutes': 'অনলাইন পেমেন্টের অপেক্ষা (মিনিট)',
  'cod.failedDeliveryBlockThreshold': 'এতবার ডেলিভারি ব্যর্থ হলে COD বন্ধ (খালি = কখনো না)',
  'delivery.bookingHorizonDays': 'কত দিন আগে পর্যন্ত স্লট দেখাবে',
  'delivery.maxAttempts': 'সর্বোচ্চ ডেলিভারি চেষ্টা',
  'orders.customerCancelUntil': 'গ্রাহক কোন ধাপ পর্যন্ত নিজে বাতিল করতে পারবেন',
  'orders.maxPendingPaymentPerCustomer': 'একজন গ্রাহকের সর্বোচ্চ পেমেন্ট-বাকি অর্ডার',
  'sms.events': 'যে ঘটনায় SMS যাবে',
  'storefront.popularMinOrders': '“জনপ্রিয়” অংশ দেখাতে ন্যূনতম আসল অর্ডার',
  'storefront.maintenance': 'রক্ষণাবেক্ষণ মোড (স্টোরফ্রন্টে অর্ডার বন্ধ)',
  'orders.lateAfterMinutes': 'স্লট শেষের কত মিনিট পর “দেরি” দেখাবে',
};

export default function SettingsPage() {
  const s = useSession();
  const global = useLoad<Setting[]>(s.can('settings.global') ? '/admin/settings' : null);
  const outlet = useLoad<Setting[]>(s.outletId && s.can('settings.outlet') ? `/admin/outlets/${s.outletId}/settings` : null);
  return (
    <>
      <PageTitle title="সেটিংস" />
      {s.can('settings.global') ? (
        <section className="mb-6" aria-labelledby="h-global">
          <h2 id="h-global" className="mb-2 font-semibold">
            সব আউটলেটের জন্য
          </h2>
          {!global.data ? <Loading error={global.error} /> : <SettingList items={global.data} base="/admin/settings" onDone={global.reload} />}
        </section>
      ) : null}
      <section aria-labelledby="h-outlet">
        <h2 id="h-outlet" className="mb-2 font-semibold">
          আউটলেট সেটিংস
        </h2>
        {!s.outletId ? (
          <p className="text-sm text-muted">আউটলেট বেছে নিলে এখানে দেখা যাবে।</p>
        ) : !outlet.data ? (
          <Loading error={outlet.error} />
        ) : (
          <SettingList items={outlet.data} base={`/admin/outlets/${s.outletId}/settings`} onDone={outlet.reload} />
        )}
      </section>
    </>
  );
}

function SettingList({ items, base, onDone }: { items: Setting[]; base: string; onDone: () => Promise<void> }) {
  return (
    <ul className="card divide-y divide-line">
      {items.map((x) => (
        <SettingRow key={x.key} item={x} base={base} onDone={onDone} />
      ))}
    </ul>
  );
}

function SettingRow({ item, base, onDone }: { item: Setting; base: string; onDone: () => Promise<void> }) {
  const [text, setText] = useState(typeof item.value === 'boolean' ? '' : JSON.stringify(item.value));
  const a = useAction();
  const id = `set-${item.key.replace(/\W/g, '-')}`;
  const save = (value: unknown) => void a.run(() => api(`${base}/${item.key}`, { method: 'PUT', body: { value } }), 'সংরক্ষিত').then((ok) => (ok ? onDone() : undefined));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="font-medium">
          {LABEL[item.key] ?? item.key}
        </label>
        <p className="text-xs text-muted">
          <span className="font-latin">{item.key}</span> — {item.doc} {item.isDefault ? <Badge>ডিফল্ট</Badge> : null}
        </p>
        <Msg error={a.error} />
      </div>
      {typeof item.value === 'boolean' ? (
        <input id={id} type="checkbox" className="h-5 w-5" checked={item.value} disabled={a.busy} onChange={(e) => save(e.target.checked)} />
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            let v: unknown;
            try {
              v = text.trim() === '' ? null : JSON.parse(text);
            } catch {
              return a.setError('মান সঠিক নয় (সংখ্যা, "লেখা", null বা ["তালিকা"])');
            }
            save(v);
          }}
        >
          <input id={id} className="field field-sm w-48 font-latin" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-ghost btn-sm" disabled={a.busy}>
            সংরক্ষণ
          </button>
        </form>
      )}
    </li>
  );
}
