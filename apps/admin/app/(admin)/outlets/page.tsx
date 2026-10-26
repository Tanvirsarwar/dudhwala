'use client';

import { useState } from 'react';
import { ROLE_OPTIONAL, type OutletRole } from '@dudhwala/shared';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime, ROLE } from '@/lib/format';
import { Badge, Empty, Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

interface Outlet {
  id: string;
  code: string;
  nameBn: string;
  nameEn: string | null;
  addressLine: string;
  phone: string | null;
  email: string | null;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  acceptsOnlineOrders: boolean;
  autoConfirmOrders: boolean;
}

interface StaffRow {
  assignmentId: string;
  role: string;
  active: boolean;
  extraPermissions: string[];
  user: { id: string; fullName: string | null; email: string | null; phone: string | null; status: string; mfaEnabled: boolean; lastLoginAt: string | null };
}

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  ACTIVE: { label: 'চালু', tone: 'good' },
  PAUSED: { label: 'বিরতি', tone: 'warn' },
  CLOSED: { label: 'বন্ধ', tone: 'bad' },
};

const PERM_LABEL: Record<string, string> = {
  'staff.manage_outlet': 'স্টাফ যোগ/বন্ধ',
  'delivery.outlet_rules_manage': 'ডেলিভারি ফি ও COD নিয়ম',
  'orders.export_csv': 'CSV এক্সপোর্ট',
  'inventory.receive': 'মাল গ্রহণ',
  'inventory.adjust': 'স্টক সমন্বয়',
  'inventory.count': 'স্টক গণনা',
  'inventory.transfer_receive': 'ট্রান্সফার গ্রহণ',
  'orders.confirm': 'অর্ডার নিশ্চিত',
  'orders.reject': 'অর্ডার প্রত্যাখ্যান',
  'orders.reschedule': 'স্লট পরিবর্তন',
  'delivery.assign': 'রাইডার নির্ধারণ',
  'delivery.upload_proof': 'ডেলিভারির প্রমাণ আপলোড',
};

export default function OutletsPage() {
  const s = useSession();
  const { data, error, reload } = useLoad<Outlet[]>('/admin/outlets');
  const [editing, setEditing] = useState<Outlet | 'new' | null>(null);
  const [staffFor, setStaffFor] = useState<Outlet | null>(null);
  const canManage = s.can('outlets.manage');
  const canStaff = s.isSuper || s.me.role === 'OUTLET_MANAGER';

  return (
    <>
      <PageTitle title="আউটলেট ও স্টাফ">
        {canManage ? (
          <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
            নতুন আউটলেট
          </button>
        ) : null}
      </PageTitle>
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>কোনো আউটলেট নেই।</Empty>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.map((o) => (
            <li key={o.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    <span className="font-latin">{o.code}</span> — {o.nameBn}
                  </p>
                  <p className="text-sm text-muted">{o.addressLine}</p>
                  <p className="font-latin text-sm text-muted">{[o.phone, o.email].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label}</Badge>
                  {o.acceptsOnlineOrders ? <Badge tone="good">অনলাইন অর্ডার নিচ্ছে</Badge> : <Badge tone="warn">অনলাইন অর্ডার বন্ধ</Badge>}
                  {o.autoConfirmOrders ? <Badge tone="info">স্বয়ংক্রিয় নিশ্চিত</Badge> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canManage ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(o)}>
                    সম্পাদনা
                  </button>
                ) : null}
                {canStaff ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setStaffFor(o)}>
                    স্টাফ
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <OutletDialog
          outlet={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            await reload();
            await s.reloadOutlets();
          }}
        />
      ) : null}
      {staffFor ? <StaffDialog outlet={staffFor} onClose={() => setStaffFor(null)} /> : null}
    </>
  );
}

function OutletDialog({ outlet, onClose, onDone }: { outlet: Outlet | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [f, setF] = useState({
    code: outlet?.code ?? '',
    nameBn: outlet?.nameBn ?? '',
    nameEn: outlet?.nameEn ?? '',
    addressLine: outlet?.addressLine ?? '',
    phone: outlet?.phone ?? '',
    email: outlet?.email ?? '',
    status: outlet?.status ?? 'PAUSED',
    acceptsOnlineOrders: outlet?.acceptsOnlineOrders ?? false,
    autoConfirmOrders: outlet?.autoConfirmOrders ?? false,
  });
  const a = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await a.run(() =>
      outlet
        ? api(`/admin/outlets/${outlet.id}`, {
            method: 'PATCH',
            body: { nameBn: f.nameBn, nameEn: f.nameEn || null, addressLine: f.addressLine, phone: f.phone || null, status: f.status, acceptsOnlineOrders: f.acceptsOnlineOrders, autoConfirmOrders: f.autoConfirmOrders },
          })
        : api('/admin/outlets', { body: { code: f.code.toUpperCase(), nameBn: f.nameBn, ...(f.nameEn ? { nameEn: f.nameEn } : {}), addressLine: f.addressLine, ...(f.phone ? { phone: f.phone } : {}), ...(f.email ? { email: f.email } : {}) } }),
    );
    if (ok) {
      await onDone();
      onClose();
    }
  }

  return (
    <Modal open title={outlet ? `আউটলেট — ${outlet.code}` : 'নতুন আউটলেট'} onClose={onClose}>
      <form onSubmit={submit}>
        {!outlet ? (
          <Field label="কোড" id="o-code" hint="ছোট ইংরেজি কোড, যেমন ZND (পরে বদলানো যায় না)।">
            <input id="o-code" className="field font-latin uppercase" value={f.code} onChange={set('code')} required aria-describedby="o-code-hint" />
          </Field>
        ) : null}
        <Field label="নাম (বাংলা)" id="o-bn">
          <input id="o-bn" className="field" value={f.nameBn} onChange={set('nameBn')} required />
        </Field>
        <Field label="নাম (English)" id="o-en">
          <input id="o-en" className="field" value={f.nameEn} onChange={set('nameEn')} />
        </Field>
        <Field label="ঠিকানা" id="o-addr">
          <input id="o-addr" className="field" value={f.addressLine} onChange={set('addressLine')} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="মোবাইল" id="o-phone">
            <input id="o-phone" className="field font-latin" inputMode="tel" value={f.phone} onChange={set('phone')} />
          </Field>
          {!outlet ? (
            <Field label="ইমেইল" id="o-email">
              <input id="o-email" type="email" className="field font-latin" value={f.email} onChange={set('email')} />
            </Field>
          ) : null}
        </div>
        {outlet ? (
          <>
            <Field label="অবস্থা" id="o-status">
              <select id="o-status" className="field" value={f.status} onChange={set('status')}>
                <option value="ACTIVE">চালু</option>
                <option value="PAUSED">বিরতি</option>
                <option value="CLOSED">বন্ধ</option>
              </select>
            </Field>
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.acceptsOnlineOrders} onChange={set('acceptsOnlineOrders')} /> অনলাইন অর্ডার নিন
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.autoConfirmOrders} onChange={set('autoConfirmOrders')} /> নতুন অর্ডার স্বয়ংক্রিয়ভাবে নিশ্চিত করুন
            </label>
          </>
        ) : (
          <p className="mb-3 text-xs text-muted">নতুন আউটলেট “বিরতি” অবস্থায় শুরু হয়। স্টক, ডেলিভারি নিয়ম ও স্লট সেটআপের পর চালু করুন।</p>
        )}
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}

function StaffDialog({ outlet, onClose }: { outlet: Outlet; onClose: () => void }) {
  const s = useSession();
  const { data, error, reload } = useLoad<StaffRow[]>(`/admin/outlets/${outlet.id}/staff`);
  const [adding, setAdding] = useState(false);
  const a = useAction();
  const canManage = s.can('staff.manage_outlet');
  return (
    <Modal open title={`স্টাফ — ${outlet.code}`} onClose={onClose}>
      <Msg error={a.error} ok={a.ok} />
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <p className="mb-3 text-sm text-muted">কোনো স্টাফ নেই।</p>
      ) : (
        <TableWrap label="স্টাফ তালিকা">
          <table className="tbl">
            <tbody>
              {data.map((r) => (
                <tr key={r.assignmentId} className={r.active ? '' : 'text-muted'}>
                  <td>
                    {r.user.fullName}
                    <div className="font-latin text-xs text-muted">{r.user.email ?? r.user.phone}</div>
                    <div className="text-xs text-muted">শেষ লগইন: {dateTime(r.user.lastLoginAt)}</div>
                  </td>
                  <td>
                    {ROLE[r.role]}
                    {r.extraPermissions.length ? <div className="text-xs text-muted">+ {r.extraPermissions.map((p) => PERM_LABEL[p] ?? p).join(', ')}</div> : null}
                  </td>
                  <td>{r.active ? <Badge tone="good">সক্রিয়</Badge> : <Badge>নিষ্ক্রিয়</Badge>}</td>
                  <td className="space-y-1">
                    {canManage && (s.isSuper || r.role !== 'OUTLET_MANAGER') && r.user.id !== s.me.user.id ? (
                      <>
                        {r.active ? (
                          <button
                            className="btn btn-ghost btn-sm text-danger"
                            disabled={a.busy}
                            onClick={() => {
                              if (window.confirm(`${r.user.fullName ?? ''} কে নিষ্ক্রিয় করবেন? সাথে সাথে সব সেশন থেকে লগআউট হবে।`))
                                void a.run(() => api(`/admin/outlets/${outlet.id}/staff/${r.assignmentId}/deactivate`, { method: 'POST' }), 'নিষ্ক্রিয় করা হয়েছে').then(() => reload());
                            }}
                          >
                            নিষ্ক্রিয়
                          </button>
                        ) : (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={a.busy}
                            onClick={() => void a.run(() => api(`/admin/outlets/${outlet.id}/staff/${r.assignmentId}/activate`, { method: 'POST' }), 'আবার সক্রিয় করা হয়েছে').then(() => reload())}
                          >
                            সক্রিয় করুন
                          </button>
                        )}
                        <button
                          className="btn btn-ghost btn-sm"
                          disabled={a.busy}
                          onClick={() => {
                            const pw = window.prompt('নতুন অস্থায়ী পাসওয়ার্ড (কমপক্ষে ১২ অক্ষর)। ব্যক্তিকে আলাদাভাবে জানান:');
                            if (!pw) return;
                            void a.run(() => api(`/admin/outlets/${outlet.id}/staff/${r.assignmentId}/reset-credentials`, { body: { temporaryPassword: pw } }), 'পাসওয়ার্ড রিসেট হয়েছে; সব সেশন বন্ধ');
                          }}
                        >
                          পাসওয়ার্ড রিসেট
                        </button>
                        {r.user.mfaEnabled ? (
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={a.busy}
                            onClick={() => {
                              if (window.confirm('দুই-ধাপ যাচাই রিসেট করবেন? পরের লগইনে নতুন করে চালু করতে হবে।'))
                                void a.run(() => api(`/admin/outlets/${outlet.id}/staff/${r.assignmentId}/reset-credentials`, { body: { resetMfa: true } }), 'দুই-ধাপ যাচাই রিসেট হয়েছে').then(() => reload());
                            }}
                          >
                            ২-ধাপ রিসেট
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {canManage ? (
        adding ? (
          <NewStaff outletId={outlet.id} onDone={async () => (setAdding(false), await reload())} onCancel={() => setAdding(false)} />
        ) : (
          <button className="btn btn-primary btn-sm mt-3" onClick={() => setAdding(true)}>
            স্টাফ যোগ করুন
          </button>
        )
      ) : null}
      <p className="mt-3 text-xs text-muted">একজন কর্মী একটি আউটলেটেই কাজ করেন। ম্যানেজার ও সুপার অ্যাডমিনকে প্রথম লগইনে দুই-ধাপ যাচাই চালু করতে হয়।</p>
    </Modal>
  );
}

function NewStaff({ outletId, onDone, onCancel }: { outletId: string; onDone: () => Promise<void>; onCancel: () => void }) {
  const s = useSession();
  const [f, setF] = useState({ fullName: '', email: '', phone: '', role: 'OUTLET_STAFF' as OutletRole, temporaryPassword: '' });
  const [extra, setExtra] = useState<Set<string>>(new Set());
  const a = useAction();
  const roles: OutletRole[] = s.isSuper ? ['OUTLET_MANAGER', 'OUTLET_STAFF', 'DELIVERY_STAFF'] : ['OUTLET_STAFF', 'DELIVERY_STAFF'];
  const optional = ROLE_OPTIONAL[f.role];
  return (
    <form
      className="mt-4 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void a.run(() =>
          api(`/admin/outlets/${outletId}/staff`, {
            body: { fullName: f.fullName, role: f.role, temporaryPassword: f.temporaryPassword, extraPermissions: [...extra].filter((x) => (optional as readonly string[]).includes(x)), ...(f.email ? { email: f.email } : {}), ...(f.phone ? { phone: f.phone } : {}) },
          }),
        ).then((ok) => (ok ? onDone() : undefined));
      }}
    >
      <h3 className="mb-2 font-semibold">নতুন স্টাফ</h3>
      <Field label="পুরো নাম" id="n-name">
        <input id="n-name" className="field" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ইমেইল" id="n-email">
          <input id="n-email" type="email" className="field font-latin" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="মোবাইল" id="n-phone">
          <input id="n-phone" className="field font-latin" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
      </div>
      <Field label="ভূমিকা" id="n-role">
        <select id="n-role" className="field" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as OutletRole })}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE[r]}
            </option>
          ))}
        </select>
      </Field>
      {optional.length ? (
        <fieldset className="mb-3">
          <legend className="label">অতিরিক্ত অনুমতি (ঐচ্ছিক)</legend>
          {optional.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={extra.has(p)}
                onChange={() =>
                  setExtra((x) => {
                    const n = new Set(x);
                    if (n.has(p)) n.delete(p);
                    else n.add(p);
                    return n;
                  })
                }
              />{' '}
              {PERM_LABEL[p] ?? p}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label="অস্থায়ী পাসওয়ার্ড" id="n-pw" hint="কমপক্ষে ১২ অক্ষর। কর্মীকে আলাদাভাবে (সামনাসামনি/ফোনে) জানান।">
        <input id="n-pw" type="text" autoComplete="new-password" className="field font-latin" value={f.temporaryPassword} onChange={(e) => setF({ ...f, temporaryPassword: e.target.value })} required minLength={12} aria-describedby="n-pw-hint" />
      </Field>
      <Msg error={a.error} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          বাতিল
        </button>
        <button className="btn btn-primary" disabled={a.busy || !f.fullName || (!f.email && !f.phone) || f.temporaryPassword.length < 12}>
          তৈরি করুন
        </button>
      </div>
    </form>
  );
}
