'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { dateTime } from '@/lib/format';
import { Badge, Empty, Field, Loading, Modal, Msg, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

interface Row {
  variantId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  onlineBuffer: number;
  availableOnline: number;
  lowStockThreshold: number;
  lowStock: boolean;
  isListed: boolean;
  version: number;
}

interface CatalogProduct {
  nameBn: string;
  variants: { id: string; sku: string; labelBn: string; status: string }[];
}

type Mode = 'receive' | 'adjust' | 'write-off' | 'settings' | 'history';

const MOVE: Record<string, string> = {
  RECEIVE: 'গ্রহণ', ADJUST_UP: 'সমন্বয় (+)', ADJUST_DOWN: 'সমন্বয় (−)', WRITE_OFF: 'রাইট-অফ', RESERVE: 'অর্ডারে সংরক্ষিত', RELEASE: 'সংরক্ষণ মুক্ত', COMMIT_SALE: 'বিক্রি (ডেলিভারি)', RESTOCK_RETURN: 'ফেরত — স্টকে',
  TRANSFER_OUT: 'ট্রান্সফার (বাইরে)', TRANSFER_IN: 'ট্রান্সফার (ভিতরে)', RECONCILE: 'মিলানো',
};

export default function InventoryPage() {
  const s = useSession();
  const { data, error, reload } = useLoad<Row[]>(s.outletId ? `/admin/outlets/${s.outletId}/inventory` : null);
  const [filter, setFilter] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [mode, setMode] = useState<{ m: Mode; row: Row | null } | null>(null);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data ?? []).filter((r) => (!onlyLow || r.lowStock) && (!f || r.sku.toLowerCase().includes(f) || r.name.toLowerCase().includes(f)));
  }, [data, filter, onlyLow]);

  if (!s.outletId) return <NeedOutlet />;

  return (
    <>
      <PageTitle title="স্টক">
        {s.can('inventory.receive') ? (
          <button className="btn btn-primary btn-sm" onClick={() => setMode({ m: 'receive', row: null })}>
            মাল গ্রহণ
          </button>
        ) : null}
      </PageTitle>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">খুঁজুন</span>
          <input className="field field-sm" placeholder="SKU বা নাম" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> শুধু কম স্টক
        </label>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>এই আউটলেটে এখনো কোনো স্টক নেই। “মাল গ্রহণ” দিয়ে শুরু করুন।</Empty>
      ) : (
        <TableWrap label="স্টক তালিকা">
          <table className="tbl">
            <thead>
              <tr>
                <th>পণ্য</th>
                <th className="text-right">হাতে</th>
                <th className="text-right">সংরক্ষিত</th>
                <th className="text-right">অনলাইনে বিক্রয়যোগ্য</th>
                <th>অবস্থা</th>
                <th>কাজ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.variantId}>
                  <td>
                    {r.name}
                    <div className="font-latin text-xs text-muted">{r.sku}</div>
                  </td>
                  <td className="text-right font-latin">{r.onHand}</td>
                  <td className="text-right font-latin">{r.reserved}</td>
                  <td className="text-right font-latin">
                    {r.availableOnline}
                    {r.onlineBuffer ? <div className="text-xs text-muted">বাফার {r.onlineBuffer}</div> : null}
                  </td>
                  <td className="space-x-1">
                    {r.lowStock ? <Badge tone="warn">কম স্টক (≤{r.lowStockThreshold})</Badge> : <Badge tone="good">ঠিক আছে</Badge>}
                    {!r.isListed ? <Badge tone="neutral">অনলাইনে লুকানো</Badge> : null}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {s.can('inventory.receive') ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode({ m: 'receive', row: r })}>
                          গ্রহণ
                        </button>
                      ) : null}
                      {s.can('inventory.adjust') ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode({ m: 'adjust', row: r })}>
                          সমন্বয়
                        </button>
                      ) : null}
                      {s.can('inventory.write_off') ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode({ m: 'write-off', row: r })}>
                          রাইট-অফ
                        </button>
                      ) : null}
                      {s.can('inventory.thresholds') ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => setMode({ m: 'settings', row: r })}>
                          সেটিং
                        </button>
                      ) : null}
                      <button className="btn btn-ghost btn-sm" onClick={() => setMode({ m: 'history', row: r })}>
                        ইতিহাস
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {mode ? (
        <StockDialog
          outletId={s.outletId}
          mode={mode.m}
          row={mode.row}
          known={data ?? []}
          onClose={() => setMode(null)}
          onDone={async () => {
            setMode(null);
            await reload();
          }}
        />
      ) : null}
    </>
  );
}

const TITLES: Record<Mode, string> = { receive: 'মাল গ্রহণ', adjust: 'স্টক সমন্বয়', 'write-off': 'রাইট-অফ (নষ্ট/মেয়াদোত্তীর্ণ)', settings: 'স্টক সেটিং', history: 'স্টক ইতিহাস' };

function StockDialog({ outletId, mode, row, known, onClose, onDone }: { outletId: string; mode: Mode; row: Row | null; known: Row[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [variantId, setVariantId] = useState(row?.variantId ?? '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [threshold, setThreshold] = useState(String(row?.lowStockThreshold ?? 0));
  const [buffer, setBuffer] = useState(String(row?.onlineBuffer ?? 0));
  const [listed, setListed] = useState(row?.isListed ?? true);
  const a = useAction();
  // Receiving a product the outlet has never stocked needs the whole catalogue.
  const catalog = useLoad<CatalogProduct[]>(mode === 'receive' && !row ? '/admin/products' : null);
  const history = useLoad<{ id: string; type: string; qtyDeltaOnHand: number; onHandAfter: number; reason: string | null; createdAt: string }[]>(
    mode === 'history' && row ? `/admin/outlets/${outletId}/inventory/movements?variantId=${row.variantId}&limit=50` : null,
  );
  const n = Number(qty);
  const qtyOk = Number.isInteger(n) && (mode === 'adjust' ? n !== 0 : n > 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const base = `/admin/outlets/${outletId}/inventory`;
    const ok = await a.run(() => {
      if (mode === 'receive') return api(`${base}/receive`, { body: { variantId, qty: n, ...(reason.trim() ? { note: reason.trim() } : {}) } });
      if (mode === 'adjust') return api(`${base}/adjust`, { body: { variantId, deltaQty: n, reason: reason.trim() } });
      if (mode === 'write-off') return api(`${base}/write-off`, { body: { variantId, qty: n, reason: reason.trim() } });
      return api(`${base}/${variantId}`, { method: 'PATCH', body: { lowStockThreshold: Number(threshold), onlineBufferQty: Number(buffer), isListed: listed, expectedVersion: row?.version ?? 0 } });
    });
    if (ok) await onDone();
  }

  return (
    <Modal open title={TITLES[mode]} onClose={onClose}>
      {row ? (
        <p className="mb-3 text-sm">
          <strong>{row.name}</strong> <span className="font-latin text-muted">({row.sku}) · হাতে {row.onHand}</span>
        </p>
      ) : null}
      {mode === 'history' ? (
        !history.data ? (
          <Loading error={history.error} />
        ) : history.data.length === 0 ? (
          <p className="text-sm text-muted">কোনো ইতিহাস নেই।</p>
        ) : (
          <ol className="max-h-80 space-y-1 overflow-y-auto text-sm">
            {history.data.map((m) => (
              <li key={m.id}>
                <span className="font-latin text-muted">{dateTime(m.createdAt)}</span> · {MOVE[m.type] ?? m.type}{' '}
                <span className="font-latin">
                  {m.qtyDeltaOnHand > 0 ? '+' : ''}
                  {m.qtyDeltaOnHand} → {m.onHandAfter}
                </span>
                {m.reason ? <span className="text-muted"> — {m.reason}</span> : null}
              </li>
            ))}
          </ol>
        )
      ) : (
        <form onSubmit={submit}>
          {!row ? (
            <Field label="পণ্য" id="s-variant">
              <select id="s-variant" className="field" value={variantId} onChange={(e) => setVariantId(e.target.value)} required>
                <option value="">— বেছে নিন —</option>
                {(catalog.data ?? []).flatMap((p) =>
                  p.variants
                    .filter((v) => v.status !== 'ARCHIVED')
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {p.nameBn} — {v.labelBn} ({v.sku}){known.some((k) => k.variantId === v.id) ? '' : ' · নতুন'}
                      </option>
                    )),
                )}
              </select>
            </Field>
          ) : null}
          {mode === 'settings' ? (
            <>
              <Field label="কম-স্টক সীমা" id="s-th" hint="অবশিষ্ট (হাতে − সংরক্ষিত) এর সমান বা কম হলে সতর্কতা।">
                <input id="s-th" type="number" min={0} className="field" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-describedby="s-th-hint" />
              </Field>
              <Field label="অনলাইন বাফার" id="s-buf" hint="দোকানের কাউন্টারের জন্য এতগুলো রেখে দেওয়া হবে; অনলাইনে বিক্রি হবে না।">
                <input id="s-buf" type="number" min={0} className="field" value={buffer} onChange={(e) => setBuffer(e.target.value)} aria-describedby="s-buf-hint" />
              </Field>
              <label className="mb-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} /> এই আউটলেট থেকে অনলাইনে বিক্রি করুন
              </label>
            </>
          ) : (
            <>
              <Field label={mode === 'adjust' ? 'পরিবর্তন (+ বা −)' : 'পরিমাণ'} id="s-qty" hint={mode === 'adjust' ? 'যেমন গণনায় ৩টি কম পেলে −3 লিখুন।' : undefined}>
                <input id="s-qty" type="number" step={1} className="field font-latin" value={qty} onChange={(e) => setQty(e.target.value)} required />
              </Field>
              <Field label={mode === 'receive' ? 'নোট (ঐচ্ছিক)' : 'কারণ (আবশ্যক)'} id="s-reason">
                <input id="s-reason" className="field" value={reason} onChange={(e) => setReason(e.target.value)} required={mode !== 'receive'} minLength={mode === 'receive' ? 0 : 3} />
              </Field>
            </>
          )}
          <Msg error={a.error} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              বাতিল
            </button>
            <button className={`btn ${mode === 'write-off' ? 'btn-danger' : 'btn-primary'}`} disabled={a.busy || !variantId || (mode !== 'settings' && (!qtyOk || (mode !== 'receive' && reason.trim().length < 3)))}>
              সংরক্ষণ
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
