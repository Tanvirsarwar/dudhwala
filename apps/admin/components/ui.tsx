'use client';

import { useEffect, useRef } from 'react';
import { COD_STATUS, ORDER_STATUS, PAYMENT_STATUS } from '@/lib/format';

/** Status badges always carry text (never colour alone — UI_UX_SPEC §8). */
const TONE: Record<string, string> = {
  good: 'bg-[#e6f4ec] text-success border-[#b7dfc6]',
  warn: 'bg-[#fff4cc] text-warning border-[#f1d98a]',
  bad: 'bg-red-50 text-danger border-red-200',
  info: 'bg-accent-100 text-[#01628c] border-[#b5e6f9]',
  neutral: 'bg-brand-100 text-brand-700 border-[#cfd1ee]',
};

export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return <span className={`badge ${TONE[tone]}`}>{children}</span>;
}

const ORDER_TONE: Record<string, keyof typeof TONE> = {
  PENDING_PAYMENT: 'warn', PLACED: 'info', CONFIRMED: 'neutral', PREPARING: 'neutral', READY_FOR_DISPATCH: 'neutral',
  OUT_FOR_DELIVERY: 'info', DELIVERED: 'good', DELIVERY_FAILED: 'bad', CANCELLED: 'bad', REJECTED: 'bad', EXPIRED: 'bad',
};
export const OrderBadge = ({ status }: { status: string }) => <Badge tone={ORDER_TONE[status] ?? 'neutral'}>{ORDER_STATUS[status] ?? status}</Badge>;

const PAY_TONE: Record<string, keyof typeof TONE> = { PAID: 'good', UNPAID: 'warn', PENDING: 'warn', FAILED: 'bad', CANCELLED: 'bad', PARTIALLY_REFUNDED: 'info', REFUNDED: 'info' };
export const PaymentBadge = ({ status, method }: { status: string; method?: string }) => (
  <Badge tone={PAY_TONE[status] ?? 'neutral'}>
    {method ? `${method === 'COD' ? 'COD' : 'অনলাইন'} · ` : ''}
    {PAYMENT_STATUS[status] ?? status}
  </Badge>
);

const COD_TONE: Record<string, keyof typeof TONE> = { PENDING: 'warn', COLLECTED: 'info', HANDED_OVER: 'good', DISCREPANCY: 'bad', NOT_COLLECTED: 'neutral' };
export const CodBadge = ({ status }: { status: string }) => <Badge tone={COD_TONE[status] ?? 'neutral'}>{COD_STATUS[status] ?? status}</Badge>;

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-bold text-brand-700">{title}</h1>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

export function Msg({ error, ok }: { error?: string | null; ok?: string | null }) {
  if (error)
    return (
      <p role="alert" className="my-2 rounded-lg bg-red-50 p-3 text-sm text-danger">
        {error}
      </p>
    );
  if (ok)
    return (
      <p role="status" className="my-2 rounded-lg bg-[#e6f4ec] p-3 text-sm text-success">
        {ok}
      </p>
    );
  return null;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card p-6 text-center text-sm text-muted">{children}</p>;
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <Msg error={error} /> : <p className="p-4 text-sm text-muted">লোড হচ্ছে…</p>;
}

/** Labelled input; `hint` renders under the control and is linked via aria-describedby. */
export function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Native <dialog> modal: focus trap, Esc to close, labelled by its title. */
export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = `dlg-${title.replace(/\W+/g, '-')}`;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={id} onClose={onClose} className="m-auto w-[min(94vw,520px)] rounded-2xl p-0 text-ink">
      {open ? (
        <div className="p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 id={id} className="text-lg font-bold text-brand-700">
              {title}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="বন্ধ করুন">
              ✕
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Horizontal scroll wrapper so wide tables never cause page-level horizontal scroll. */
export function TableWrap({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="card overflow-x-auto" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Asks the Super Admin to pick an outlet when a screen is per-outlet. */
export function NeedOutlet() {
  return <Empty>এই পাতাটি একটি নির্দিষ্ট আউটলেটের জন্য। উপরের তালিকা থেকে আউটলেট বেছে নিন।</Empty>;
}
