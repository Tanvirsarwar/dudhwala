'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime, taka, toPoisha } from '@/lib/format';
import { Badge, Empty, Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

interface Coupon {
  id: string;
  code: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  value: number;
  maxDiscountPoisha: number | null;
  minOrderPoisha: number;
  startsAt: string | null;
  endsAt: string | null;
  usageLimitTotal: number | null;
  usageLimitPerCustomer: number | null;
  usedCount: number;
  outletIds: string[];
  firstOrderOnly: boolean;
  active: boolean;
}

const describe = (c: Coupon) => (c.type === 'PERCENT' ? `${c.value / 100}% ছাড়${c.maxDiscountPoisha ? ` (সর্বোচ্চ ${taka(c.maxDiscountPoisha)})` : ''}` : c.type === 'FIXED' ? `${taka(c.value)} ছাড়` : 'ফ্রি ডেলিভারি');

export default function CouponsPage() {
  const { data, error, reload } = useLoad<Coupon[]>('/admin/coupons');
  const [open, setOpen] = useState(false);
  const a = useAction();
  return (
    <>
      <PageTitle title="কুপন">
        <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
          নতুন কুপন
        </button>
      </PageTitle>
      <Msg error={a.error} ok={a.ok} />
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>কোনো কুপন নেই।</Empty>
      ) : (
        <TableWrap label="কুপন তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>কোড</th>
                <th>ছাড়</th>
                <th>শর্ত</th>
                <th>মেয়াদ</th>
                <th className="text-right">ব্যবহার</th>
                <th>অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="font-latin font-semibold">{c.code}</td>
                  <td>{describe(c)}</td>
                  <td className="text-xs">
                    {c.minOrderPoisha ? <div>ন্যূনতম {taka(c.minOrderPoisha)}</div> : null}
                    {c.firstOrderOnly ? <div>শুধু প্রথম অর্ডার</div> : null}
                    {c.usageLimitPerCustomer ? <div>জনপ্রতি {c.usageLimitPerCustomer} বার</div> : null}
                    {c.outletIds.length ? <div>{c.outletIds.length}টি আউটলেটে</div> : <div>সব আউটলেটে</div>}
                  </td>
                  <td className="font-latin text-xs">
                    {dateTime(c.startsAt)} → {dateTime(c.endsAt)}
                  </td>
                  <td className="text-right font-latin">
                    {c.usedCount}
                    {c.usageLimitTotal ? ` / ${c.usageLimitTotal}` : ''}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => void a.run(() => api(`/admin/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } })).then(() => reload())}>
                      {c.active ? <Badge tone="good">চালু</Badge> : <Badge>বন্ধ</Badge>}
                      <span className="sr-only">{c.active ? 'বন্ধ করুন' : 'চালু করুন'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {open ? <NewCoupon onClose={() => setOpen(false)} onDone={reload} /> : null}
    </>
  );
}

function NewCoupon({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const s = useSession();
  const [f, setF] = useState({ code: '', type: 'PERCENT', value: '', maxDiscount: '', minOrder: '', startsAt: '', endsAt: '', limitTotal: '', limitPer: '1', firstOrderOnly: false, active: false });
  const [outlets, setOutlets] = useState<Set<string>>(new Set());
  const a = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }));
  const value = f.type === 'PERCENT' ? Math.round(Number(f.value) * 100) : f.type === 'FIXED' ? toPoisha(f.value) : 0;
  const valid = /^[A-Za-z0-9-]{3,40}$/.test(f.code) && (f.type === 'FREE_DELIVERY' || (value !== null && value > 0 && (f.type !== 'PERCENT' || value <= 10_000)));
  const local = (d: string) => (d ? new Date(`${d}:00+06:00`).toISOString() : null);

  return (
    <Modal open title="নতুন কুপন" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(() =>
            api('/admin/coupons', {
              body: {
                code: f.code.toUpperCase(),
                type: f.type,
                value,
                maxDiscountPoisha: f.maxDiscount ? toPoisha(f.maxDiscount) : null,
                minOrderPoisha: f.minOrder ? (toPoisha(f.minOrder) ?? 0) : 0,
                startsAt: local(f.startsAt),
                endsAt: local(f.endsAt),
                usageLimitTotal: f.limitTotal ? Number(f.limitTotal) : null,
                usageLimitPerCustomer: f.limitPer ? Number(f.limitPer) : null,
                outletIds: [...outlets],
                firstOrderOnly: f.firstOrderOnly,
                active: f.active,
              },
            }),
          ).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="কোড" id="k-code">
            <input id="k-code" className="field font-latin uppercase" value={f.code} onChange={set('code')} required />
          </Field>
          <Field label="ধরন" id="k-type">
            <select id="k-type" className="field" value={f.type} onChange={set('type')}>
              <option value="PERCENT">শতাংশ ছাড়</option>
              <option value="FIXED">নির্দিষ্ট টাকা ছাড়</option>
              <option value="FREE_DELIVERY">ফ্রি ডেলিভারি</option>
            </select>
          </Field>
          {f.type !== 'FREE_DELIVERY' ? (
            <Field label={f.type === 'PERCENT' ? 'শতাংশ (%)' : 'টাকা (৳)'} id="k-val">
              <input id="k-val" className="field font-latin" inputMode="decimal" value={f.value} onChange={set('value')} required />
            </Field>
          ) : null}
          {f.type === 'PERCENT' ? (
            <Field label="সর্বোচ্চ ছাড় (৳)" id="k-max">
              <input id="k-max" className="field font-latin" inputMode="decimal" value={f.maxDiscount} onChange={set('maxDiscount')} />
            </Field>
          ) : null}
          <Field label="ন্যূনতম অর্ডার (৳)" id="k-min">
            <input id="k-min" className="field font-latin" inputMode="decimal" value={f.minOrder} onChange={set('minOrder')} />
          </Field>
          <Field label="মোট ব্যবহার সীমা" id="k-lt">
            <input id="k-lt" type="number" min={1} className="field font-latin" value={f.limitTotal} onChange={set('limitTotal')} />
          </Field>
          <Field label="জনপ্রতি সীমা" id="k-lp">
            <input id="k-lp" type="number" min={1} className="field font-latin" value={f.limitPer} onChange={set('limitPer')} />
          </Field>
          <Field label="শুরু (ঢাকা সময়)" id="k-start">
            <input id="k-start" type="datetime-local" className="field font-latin" value={f.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="শেষ (ঢাকা সময়)" id="k-end">
            <input id="k-end" type="datetime-local" className="field font-latin" value={f.endsAt} onChange={set('endsAt')} />
          </Field>
        </div>
        <fieldset className="mb-3">
          <legend className="label">আউটলেট (কিছু না বাছলে সব আউটলেট)</legend>
          {s.outlets.map((o) => (
            <label key={o.id} className="mr-3 inline-flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={outlets.has(o.id)}
                onChange={() =>
                  setOutlets((x) => {
                    const n = new Set(x);
                    if (n.has(o.id)) n.delete(o.id);
                    else n.add(o.id);
                    return n;
                  })
                }
              />{' '}
              {o.code}
            </label>
          ))}
        </fieldset>
        <label className="mb-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.firstOrderOnly} onChange={set('firstOrderOnly')} /> শুধু প্রথম অর্ডারে
        </label>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={f.active} onChange={set('active')} /> এখনই চালু করুন
        </label>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || !valid}>
          তৈরি করুন
        </button>
      </form>
    </Modal>
  );
}
