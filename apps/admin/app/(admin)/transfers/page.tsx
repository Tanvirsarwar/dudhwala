'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/format';
import { Badge, Empty, Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

interface Transfer {
  id: string;
  status: 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' | 'DRAFT';
  fromOutletId: string;
  toOutletId: string;
  requestedById: string;
  createdAt: string;
  fromOutlet: { code: string };
  toOutlet: { code: string };
  lines: { productVariantId: string; qty: number; receivedQty: number | null; variant: { sku: string; labelBn: string; product: { nameBn: string } } }[];
}
interface OutletLite {
  id: string;
  code: string;
  nameBn: string;
}
interface CatalogProduct {
  nameBn: string;
  variants: { id: string; sku: string; labelBn: string; status: string }[];
}

const STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'neutral' | 'bad' }> = {
  REQUESTED: { label: 'অনুরোধ', tone: 'warn' },
  APPROVED: { label: 'অনুমোদিত', tone: 'warn' },
  IN_TRANSIT: { label: 'পথে', tone: 'warn' },
  RECEIVED: { label: 'গ্রহণ সম্পন্ন', tone: 'good' },
  CANCELLED: { label: 'বাতিল', tone: 'neutral' },
  DRAFT: { label: 'খসড়া', tone: 'neutral' },
};

/** Inter-outlet stock transfers: request → Super Admin approves → source dispatches → destination receives. */
export default function TransfersPage() {
  const s = useSession();
  const { data, error, reload } = useLoad<Transfer[]>('/admin/transfers');
  const [requesting, setRequesting] = useState(false);
  const [receiving, setReceiving] = useState<Transfer | null>(null);
  const a = useAction();
  const mine = (outletId: string) => s.isSuper || s.me.outletId === outletId;
  const act = (t: Transfer, step: 'approve' | 'dispatch' | 'cancel', ok: string) =>
    void a.run(() => api(`/admin/transfers/${t.id}/${step}`, { method: 'POST' }), ok).then((done) => (done ? reload() : undefined));

  return (
    <>
      <PageTitle title="আউটলেটের মধ্যে স্টক ট্রান্সফার">
        {s.can('inventory.transfer_request') ? (
          <button className="btn btn-primary" onClick={() => setRequesting(true)}>
            নতুন অনুরোধ
          </button>
        ) : null}
      </PageTitle>
      <Msg error={a.error ?? error} ok={a.ok} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <Empty>কোনো ট্রান্সফার নেই। ট্রান্সফার চালু না থাকলে সেটিংসে “inventory.transfers.enabled” চালু করতে হবে (শুধু সুপার অ্যাডমিন)।</Empty>
      ) : (
        <TableWrap label="ট্রান্সফার তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>তারিখ</th>
                <th>থেকে → কোথায়</th>
                <th>পণ্য</th>
                <th>অবস্থা</th>
                <th>কাজ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td className="font-latin">{dateTime(t.createdAt)}</td>
                  <td className="font-latin">
                    {t.fromOutlet.code} → {t.toOutlet.code}
                  </td>
                  <td>
                    <ul className="text-sm">
                      {t.lines.map((l) => (
                        <li key={l.productVariantId}>
                          {l.variant.product.nameBn} — {l.variant.labelBn}: <span className="font-latin">{l.qty}</span>
                          {l.receivedQty != null && l.receivedQty !== l.qty ? <span className="text-danger"> (পেয়েছে {l.receivedQty})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td>
                    <Badge tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label ?? t.status}</Badge>
                  </td>
                  <td className="space-x-1 whitespace-nowrap">
                    {t.status === 'REQUESTED' && s.can('inventory.transfer_approve') ? (
                      <button className="btn btn-primary btn-sm" disabled={a.busy} onClick={() => act(t, 'approve', 'অনুমোদিত')}>
                        অনুমোদন
                      </button>
                    ) : null}
                    {t.status === 'APPROVED' && mine(t.fromOutletId) && s.can('inventory.adjust') ? (
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={a.busy}
                        onClick={() => {
                          if (window.confirm('পণ্য পাঠাচ্ছেন? এখনই আপনার আউটলেটের স্টক থেকে কমে যাবে।')) act(t, 'dispatch', 'পাঠানো হয়েছে');
                        }}
                      >
                        পাঠানো হলো
                      </button>
                    ) : null}
                    {t.status === 'IN_TRANSIT' && mine(t.toOutletId) && s.can('inventory.transfer_receive') ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setReceiving(t)}>
                        গ্রহণ করুন
                      </button>
                    ) : null}
                    {(t.status === 'REQUESTED' || t.status === 'APPROVED') && (s.isSuper || t.requestedById === s.me.user.id) ? (
                      <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => act(t, 'cancel', 'বাতিল')}>
                        বাতিল
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {requesting ? <RequestForm onClose={() => setRequesting(false)} onDone={reload} /> : null}
      {receiving ? <ReceiveForm t={receiving} onClose={() => setReceiving(null)} onDone={reload} /> : null}
    </>
  );
}

function RequestForm({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const s = useSession();
  const outlets = useLoad<OutletLite[]>('/admin/transfers/outlets');
  const catalog = useLoad<CatalogProduct[]>('/admin/products');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(s.me.outletId ?? '');
  const [lines, setLines] = useState<{ variantId: string; qty: string }[]>([{ variantId: '', qty: '1' }]);
  const a = useAction();
  const variants = (catalog.data ?? []).flatMap((p) => p.variants.filter((v) => v.status !== 'ARCHIVED').map((v) => ({ id: v.id, label: `${p.nameBn} — ${v.labelBn} (${v.sku})` })));
  const valid = from && to && from !== to && lines.every((l) => l.variantId && /^[1-9]\d*$/.test(l.qty));
  return (
    <Modal open title="ট্রান্সফারের অনুরোধ" onClose={onClose}>
      {outlets.error ? <Msg error={outlets.error} /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="যে আউটলেট থেকে" id="t-from">
          <select id="t-from" className="field" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">বেছে নিন</option>
            {(outlets.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.nameBn}
              </option>
            ))}
          </select>
        </Field>
        <Field label="যে আউটলেটে" id="t-to">
          <select id="t-to" className="field" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">বেছে নিন</option>
            {(outlets.data ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.code} — {o.nameBn}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_90px_auto] items-end gap-2">
          <Field label="পণ্য" id={`t-v-${i}`}>
            <select id={`t-v-${i}`} className="field" value={l.variantId} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, variantId: e.target.value } : y)))}>
              <option value="">বেছে নিন</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="পরিমাণ" id={`t-q-${i}`}>
            <input id={`t-q-${i}`} className="field font-latin" inputMode="numeric" value={l.qty} onChange={(e) => setLines((x) => x.map((y, j) => (j === i ? { ...y, qty: e.target.value } : y)))} />
          </Field>
          <button className="btn btn-ghost btn-sm mb-3" disabled={lines.length === 1} onClick={() => setLines((x) => x.filter((_, j) => j !== i))} aria-label="লাইন মুছুন">
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm mb-3" onClick={() => setLines((x) => [...x, { variantId: '', qty: '1' }])}>
        + আরেকটি পণ্য
      </button>
      <Msg error={a.error} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          বাতিল
        </button>
        <button
          className="btn btn-primary"
          disabled={a.busy || !valid}
          onClick={() =>
            void a.run(() => api('/admin/transfers', { body: { fromOutletId: from, toOutletId: to, lines: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty) })) } })).then(async (ok) => {
              if (ok) {
                await onDone();
                onClose();
              }
            })
          }
        >
          অনুরোধ পাঠান
        </button>
      </div>
    </Modal>
  );
}

function ReceiveForm({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => Promise<void> }) {
  const [got, setGot] = useState<Record<string, string>>(Object.fromEntries(t.lines.map((l) => [l.productVariantId, String(l.qty)])));
  const [note, setNote] = useState('');
  const a = useAction();
  const valid = t.lines.every((l) => /^\d+$/.test(got[l.productVariantId] ?? '') && Number(got[l.productVariantId]) <= l.qty);
  return (
    <Modal open title="ট্রান্সফার গ্রহণ" onClose={onClose}>
      <p className="mb-2 text-sm text-muted">আসলে কতটি পৌঁছেছে লিখুন। কম পৌঁছালে পার্থক্য রেকর্ড থাকবে।</p>
      {t.lines.map((l) => (
        <Field key={l.productVariantId} label={`${l.variant.product.nameBn} — ${l.variant.labelBn} (পাঠানো ${l.qty})`} id={`r-${l.productVariantId}`}>
          <input id={`r-${l.productVariantId}`} className="field font-latin" inputMode="numeric" value={got[l.productVariantId] ?? ''} onChange={(e) => setGot((x) => ({ ...x, [l.productVariantId]: e.target.value }))} />
        </Field>
      ))}
      <Field label="নোট" id="r-note">
        <input id="r-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Msg error={a.error} />
      <div className="flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          বাতিল
        </button>
        <button
          className="btn btn-primary"
          disabled={a.busy || !valid}
          onClick={() =>
            void a
              .run(() => api(`/admin/transfers/${t.id}/receive`, { body: { lines: t.lines.map((l) => ({ variantId: l.productVariantId, receivedQty: Number(got[l.productVariantId]) })), ...(note.trim() ? { note: note.trim() } : {}) } }))
              .then(async (ok) => {
                if (ok) {
                  await onDone();
                  onClose();
                }
              })
          }
        >
          গ্রহণ নিশ্চিত
        </button>
      </div>
    </Modal>
  );
}
