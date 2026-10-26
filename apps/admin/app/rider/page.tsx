'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { slot, taka, toPoisha } from '@/lib/format';
import { Field, Modal, Msg } from '@/components/ui';

interface Delivery {
  deliveryId: string;
  status: string;
  collectPoisha: number;
  order: {
    id: string;
    orderNumber: string;
    status: string;
    slotStartsAt: string;
    slotEndsAt: string;
    shipName: string;
    shipPhone: string;
    shipLine1: string;
    shipLine2: string | null;
    shipLandmark: string | null;
    shipAreaNameBn: string;
    shipInstructions: string | null;
    paymentMethod: string;
    items: { productNameBn: string; variantLabelBn: string; quantity: number }[];
  };
}

/** A status update waiting to reach the server. The client id makes retries safe (never applied twice). */
interface Pending {
  clientUpdateId: string;
  deliveryId: string;
  orderNumber: string;
  kind: 'status' | 'complete' | 'fail';
  body: Record<string, unknown>;
}

const QUEUE_KEY = 'dw.rider.queue';
const loadQueue = (): Pending[] => {
  try {
    return JSON.parse(window.localStorage.getItem(QUEUE_KEY) ?? '[]') as Pending[];
  } catch {
    return [];
  }
};
const saveQueue = (q: Pending[]) => {
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage unavailable: queue lives in memory for this page view */
  }
};
const newClientId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `cu-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

const FAIL_REASONS = [
  ['CUSTOMER_UNAVAILABLE', 'গ্রাহক পাওয়া যায়নি / ফোন ধরেননি'],
  ['WRONG_ADDRESS', 'ভুল ঠিকানা'],
  ['REFUSED', 'গ্রাহক নেননি'],
  ['OTHER', 'অন্যান্য'],
] as const;

const STATUS_BN: Record<string, string> = {
  ASSIGNED: 'নির্ধারিত',
  PICKED_UP: 'হাতে নেওয়া',
  ARRIVED: 'পৌঁছেছি',
  DELIVERED: 'ডেলিভারি সম্পন্ন',
  FAILED: 'ব্যর্থ',
};

export default function RiderPage() {
  const s = useSession();
  const [list, setList] = useState<Delivery[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [online, setOnline] = useState(true);
  const [notice, setNotice] = useState<{ error?: string; ok?: string }>({});
  const [completing, setCompleting] = useState<Delivery | null>(null);
  const [failing, setFailing] = useState<Delivery | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await api<Delivery[]>('/rider/deliveries'));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof TypeError ? 'নেটওয়ার্ক নেই — শেষ তালিকা দেখানো হচ্ছে।' : errorText(e));
    }
  }, []);

  /** Sends queued updates in order; network errors keep them queued, server rejections drop them with a message. */
  const flush = useCallback(async () => {
    let q = loadQueue();
    while (q.length) {
      const p = q[0] as Pending;
      const path = `/rider/deliveries/${p.deliveryId}/${p.kind}`;
      try {
        await api(path, { body: { ...p.body, clientUpdateId: p.clientUpdateId } });
        setNotice({ ok: `${p.orderNumber}: আপডেট পাঠানো হয়েছে` });
      } catch (e) {
        if (e instanceof TypeError || (e instanceof ApiError && (e.status >= 500 || e.status === 429))) break; // offline or server busy: retry later
        setNotice({ error: `${p.orderNumber}: ${errorText(e)}` });
        if (e instanceof ApiError && e.status === 401) break;
      }
      q = q.slice(1);
      saveQueue(q);
    }
    setQueue(q);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    setQueue(loadQueue());
    setOnline(navigator.onLine);
    void flush();
    const on = () => {
      setOnline(true);
      void flush();
    };
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const t = setInterval(() => void flush(), 60_000);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      clearInterval(t);
    };
  }, [flush]);

  const enqueue = async (d: Delivery, kind: Pending['kind'], body: Record<string, unknown>) => {
    const q = [...loadQueue(), { clientUpdateId: newClientId(), deliveryId: d.deliveryId, orderNumber: d.order.orderNumber, kind, body }];
    saveQueue(q);
    setQueue(q);
    await flush();
  };

  const pendingFor = (id: string) => queue.some((p) => p.deliveryId === id);
  const active = (list ?? []).filter((d) => !['DELIVERED', 'FAILED'].includes(d.status));
  const done = (list ?? []).filter((d) => ['DELIVERED', 'FAILED'].includes(d.status));

  return (
    <div className="mx-auto min-h-screen max-w-md bg-milk">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-brand-600 px-4 py-3 text-white">
        <div>
          <h1 className="font-bold">আজকের ডেলিভারি</h1>
          <p className="text-xs opacity-90">{s.me.user.fullName}</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-sm bg-white/15 text-white" onClick={() => void flush()} aria-label="রিফ্রেশ">
            ↻
          </button>
          <button className="btn btn-sm bg-white/15 text-white" onClick={() => void s.logout()}>
            লগআউট
          </button>
        </div>
      </header>
      <main id="main" className="p-3">
        {!online ? (
          <p role="status" className="mb-3 rounded-lg bg-[#fff4cc] p-3 text-sm text-warning">
            অফলাইন — আপডেট ফোনে জমা থাকবে, নেটওয়ার্ক এলে নিজে থেকে পাঠানো হবে।
          </p>
        ) : null}
        {queue.length ? (
          <p role="status" className="mb-3 rounded-lg bg-accent-100 p-3 text-sm text-[#01628c]">
            {queue.length}টি আপডেট পাঠানোর অপেক্ষায়।
          </p>
        ) : null}
        <Msg error={notice.error ?? loadError} ok={notice.ok} />
        {!list ? (
          <p className="p-4 text-muted">লোড হচ্ছে…</p>
        ) : active.length === 0 ? (
          <p className="card p-6 text-center text-muted">এখন আপনার কোনো ডেলিভারি নেই।</p>
        ) : (
          <ol className="space-y-3">
            {active.map((d) => (
              <li key={d.deliveryId} className="card p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-latin text-sm text-muted">{d.order.orderNumber}</p>
                    <p className="font-latin font-semibold">{slot(d.order.slotStartsAt, d.order.slotEndsAt).slice(11)}</p>
                  </div>
                  <span className="badge border-[#cfd1ee] bg-brand-100 text-brand-700">{d.order.status === 'OUT_FOR_DELIVERY' ? STATUS_BN[d.status] ?? d.status : 'আউটলেটে প্রস্তুত হচ্ছে'}</span>
                </div>
                <p className="text-lg font-semibold">{d.order.shipName}</p>
                <p>
                  {d.order.shipLine1}
                  {d.order.shipLine2 ? `, ${d.order.shipLine2}` : ''}, {d.order.shipAreaNameBn}
                </p>
                {d.order.shipLandmark ? <p className="text-sm text-muted">ল্যান্ডমার্ক: {d.order.shipLandmark}</p> : null}
                {d.order.shipInstructions ? <p className="text-sm text-muted">নির্দেশনা: {d.order.shipInstructions}</p> : null}
                <ul className="my-2 text-sm">
                  {d.order.items.map((i, idx) => (
                    <li key={idx}>
                      {i.productNameBn} — {i.variantLabelBn} × <span className="font-latin">{i.quantity}</span>
                    </li>
                  ))}
                </ul>
                {d.collectPoisha ? (
                  <p className="mb-2 rounded-lg bg-[#fff4cc] p-2 font-semibold text-warning">
                    ক্যাশ নিতে হবে: <span className="font-latin text-lg">{taka(d.collectPoisha)}</span>
                  </p>
                ) : (
                  <p className="mb-2 text-sm text-success">{d.order.paymentMethod === 'ONLINE' ? 'অনলাইনে পরিশোধিত — টাকা নেবেন না' : 'ক্যাশ নেওয়ার কিছু নেই'}</p>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <a className="btn btn-ghost min-h-12" href={`tel:${d.order.shipPhone}`}>
                    কল করুন
                  </a>
                  <a className="btn btn-ghost min-h-12" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.order.shipLine1}, ${d.order.shipAreaNameBn}, Sylhet`)}`}>
                    ম্যাপে দেখুন
                  </a>
                </div>
                {d.order.status === 'OUT_FOR_DELIVERY' ? (
                  <div className="mt-2 grid grid-cols-1 gap-2">
                    {d.status !== 'ARRIVED' ? (
                      <button className="btn btn-ghost min-h-12" disabled={pendingFor(d.deliveryId)} onClick={() => void enqueue(d, 'status', { to: 'ARRIVED' })}>
                        পৌঁছেছি
                      </button>
                    ) : null}
                    <button className="btn btn-primary min-h-12" disabled={pendingFor(d.deliveryId)} onClick={() => setCompleting(d)}>
                      ডেলিভারি সম্পন্ন
                    </button>
                    <button className="btn btn-ghost min-h-12 text-danger" disabled={pendingFor(d.deliveryId)} onClick={() => setFailing(d)}>
                      ডেলিভারি করা যায়নি
                    </button>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">আউটলেট থেকে হাতে দেওয়ার পর এখানে আপডেট দিতে পারবেন।</p>
                )}
              </li>
            ))}
          </ol>
        )}
        {done.length ? (
          <section className="mt-6" aria-labelledby="h-done">
            <h2 id="h-done" className="mb-2 text-sm font-semibold text-muted">
              শেষ হয়েছে
            </h2>
            <ul className="space-y-1 text-sm text-muted">
              {done.map((d) => (
                <li key={d.deliveryId}>
                  <span className="font-latin">{d.order.orderNumber}</span> · {d.order.shipName} · {STATUS_BN[d.status]}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>

      {completing ? (
        <CompleteDialog
          d={completing}
          onClose={() => setCompleting(null)}
          onSubmit={async (body) => {
            setCompleting(null);
            await enqueue(completing, 'complete', body);
          }}
        />
      ) : null}
      {failing ? (
        <FailDialog
          d={failing}
          onClose={() => setFailing(null)}
          onSubmit={async (body) => {
            setFailing(null);
            await enqueue(failing, 'fail', body);
          }}
        />
      ) : null}
    </div>
  );
}

function CompleteDialog({ d, onClose, onSubmit }: { d: Delivery; onClose: () => void; onSubmit: (b: Record<string, unknown>) => Promise<void> }) {
  const cod = d.order.paymentMethod === 'COD';
  const [amount, setAmount] = useState(cod ? String(d.collectPoisha / 100) : '');
  const [note, setNote] = useState('');
  const p = toPoisha(amount);
  const differs = cod && p !== null && p !== d.collectPoisha;
  return (
    <Modal open title="ডেলিভারি সম্পন্ন" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ ...(cod ? { codCollectedPoisha: p } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
        }}
      >
        <p className="mb-3 text-sm">
          <span className="font-latin">{d.order.orderNumber}</span> — {d.order.shipName}
        </p>
        {cod ? (
          <Field label="কত টাকা নিয়েছেন (৳)" id="d-amt" hint={`প্রত্যাশিত ${taka(d.collectPoisha)}`}>
            <input id="d-amt" className="field font-latin text-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required aria-describedby="d-amt-hint" />
          </Field>
        ) : null}
        <Field label={differs ? 'কেন কম/বেশি? (আবশ্যক)' : 'নোট (ঐচ্ছিক)'} id="d-note">
          <input id="d-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} required={differs} minLength={differs ? 3 : 0} />
        </Field>
        {differs ? <p className="mb-3 text-sm text-warning">টাকার পরিমাণ মিলছে না — ম্যানেজারকে জানানো হবে।</p> : null}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost min-h-12" onClick={onClose}>
            ফিরে যান
          </button>
          <button className="btn btn-primary min-h-12" disabled={(cod && p === null) || (differs && note.trim().length < 3)}>
            নিশ্চিত করুন
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FailDialog({ d, onClose, onSubmit }: { d: Delivery; onClose: () => void; onSubmit: (b: Record<string, unknown>) => Promise<void> }) {
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  return (
    <Modal open title="ডেলিভারি করা যায়নি" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({ reason, note: note.trim() });
        }}
      >
        <p className="mb-3 text-sm">
          <span className="font-latin">{d.order.orderNumber}</span> — {d.order.shipName}
        </p>
        <fieldset className="mb-3 space-y-2">
          <legend className="label">কারণ</legend>
          {FAIL_REASONS.map(([k, l]) => (
            <label key={k} className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-3">
              <input type="radio" name="reason" value={k} checked={reason === k} onChange={() => setReason(k)} /> {l}
            </label>
          ))}
        </fieldset>
        <Field label="বিস্তারিত (আবশ্যক)" id="f-note">
          <input id="f-note" className="field" value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} />
        </Field>
        <p className="mb-3 text-sm text-muted">পণ্য আউটলেটে ফেরত দিন। ম্যানেজার নতুন সময় ঠিক করবেন।</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-ghost min-h-12" onClick={onClose}>
            ফিরে যান
          </button>
          <button className="btn btn-danger min-h-12" disabled={!reason || note.trim().length < 3}>
            জমা দিন
          </button>
        </div>
      </form>
    </Modal>
  );
}
