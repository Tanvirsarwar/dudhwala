'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, cartChanged, type Area } from '@/lib/api';
import { ORDER_STATUS_BN, slotLabel, taka } from '@/lib/format';
import { OtpLogin } from '@/components/otp-login';
import { PrivacyControls } from '@/components/privacy-controls';

interface Profile {
  id: string;
  fullName: string | null;
  phone: string;
}
interface Address {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  isDefault: boolean;
  area: { nameBn: string; active: boolean };
}
interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  totalPoisha: number;
  slotStartsAt: string;
  slotEndsAt: string;
}

export default function AccountPage() {
  const [state, setState] = useState<'loading' | 'anon' | 'ready'>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ label: '', recipientName: '', phone: '', areaId: '', line1: '' });

  const load = useCallback(async () => {
    try {
      const p = await api<Profile>('/me/profile');
      setProfile(p);
      setName(p.fullName ?? '');
      const [a, o, ar] = await Promise.all([api<Address[]>('/me/addresses'), api<OrderRow[]>('/me/orders'), api<Area[]>('/delivery/areas')]);
      setAddresses(a);
      setOrders(o);
      setAreas(ar);
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setState('anon');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const saveName = async () => {
    await api('/me/profile', { method: 'PATCH', body: { fullName: name } });
    setMsg('নাম সংরক্ষিত হয়েছে');
  };
  const addAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api('/me/addresses', { method: 'POST', body: { ...form, label: form.label || null } });
      setForm({ label: '', recipientName: '', phone: '', areaId: '', line1: '' });
      setMsg('ঠিকানা যোগ হয়েছে');
      void load();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'যোগ করা যায়নি');
    }
  };
  const remove = async (id: string) => {
    await api(`/me/addresses/${id}`, { method: 'DELETE' });
    void load();
  };
  const makeDefault = async (id: string) => {
    await api(`/me/addresses/${id}`, { method: 'PATCH', body: { isDefault: true } });
    void load();
  };
  const logout = async () => {
    await api('/auth/logout', { method: 'POST' });
    cartChanged();
    setState('anon');
  };

  if (state === 'loading') return <p className="pt-10 text-center text-muted">লোড হচ্ছে…</p>;
  if (state === 'anon')
    return (
      <div className="mx-auto max-w-md pt-8">
        <OtpLogin onDone={() => void load()} />
      </div>
    );

  return (
    <div className="mx-auto grid max-w-3xl gap-5 pt-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">আমার অ্যাকাউন্ট</h1>
        <button className="btn btn-ghost" onClick={() => void logout()}>
          বের হন
        </button>
      </div>
      {msg && (
        <p role="status" className="rounded-lg bg-accent-100 p-3 text-sm text-brand-700">
          {msg}
        </p>
      )}

      <section className="card p-5" aria-labelledby="a-orders">
        <h2 id="a-orders" className="mb-3 text-lg font-bold">
          আমার অর্ডার
        </h2>
        {orders.length === 0 ? (
          <p className="text-muted">এখনো কোনো অর্ডার নেই।</p>
        ) : (
          <ul className="grid gap-2">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/orders/${o.id}`} className="flex flex-wrap justify-between gap-2 rounded-xl border border-line p-3 hover:bg-brand-100">
                  <span>
                    <strong>{o.orderNumber}</strong>
                    <span className="block text-sm text-muted">{slotLabel(o.slotStartsAt, o.slotEndsAt)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-semibold">{taka(o.totalPoisha)}</span>
                    <span className="text-sm">{ORDER_STATUS_BN[o.status] ?? o.status}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card p-5" aria-labelledby="a-profile">
        <h2 id="a-profile" className="mb-3 text-lg font-bold">
          প্রোফাইল
        </h2>
        <p className="text-sm text-muted">মোবাইল: {profile?.phone}</p>
        <div className="mt-2 flex gap-2">
          <label htmlFor="p-name" className="sr-only">
            নাম
          </label>
          <input id="p-name" className="field" placeholder="আপনার নাম" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" disabled={!name.trim()} onClick={() => void saveName()}>
            সংরক্ষণ
          </button>
        </div>
      </section>

      <section className="card p-5" aria-labelledby="a-addr">
        <h2 id="a-addr" className="mb-3 text-lg font-bold">
          ঠিকানা
        </h2>
        <ul className="grid gap-2">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3">
              <span>
                <strong>{a.label ?? a.recipientName}</strong> {a.isDefault && <span className="rounded bg-brand-100 px-1.5 text-xs">ডিফল্ট</span>}
                <span className="block text-sm text-muted">
                  {a.line1}, {a.area.nameBn}
                </span>
              </span>
              <span className="flex gap-2 text-sm">
                {!a.isDefault && (
                  <button className="underline" onClick={() => void makeDefault(a.id)}>
                    ডিফল্ট করুন
                  </button>
                )}
                <button className="text-danger underline" onClick={() => void remove(a.id)}>
                  মুছুন
                </button>
              </span>
            </li>
          ))}
        </ul>
        <form onSubmit={(e) => void addAddress(e)} className="mt-4 grid gap-2 sm:grid-cols-2">
          <input aria-label="লেবেল (যেমন: বাসা)" className="field" placeholder="লেবেল (যেমন: বাসা)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <input aria-label="প্রাপকের নাম" className="field" placeholder="প্রাপকের নাম" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} required />
          <input aria-label="মোবাইল" className="field" placeholder="মোবাইল" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          <select aria-label="এলাকা" className="field" value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })} required>
            <option value="">এলাকা</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nameBn}
              </option>
            ))}
          </select>
          <input aria-label="বাসা / রাস্তা" className="field sm:col-span-2" placeholder="বাসা / রাস্তা" value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} required />
          <button className="btn btn-primary sm:col-span-2">ঠিকানা যোগ করুন</button>
        </form>
      </section>

      <PrivacyControls />
    </div>
  );
}
