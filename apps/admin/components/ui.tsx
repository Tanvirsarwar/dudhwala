'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { DemoOrderStatus } from '@dudhwala/shared';
import { ORDER_STATUS_BN } from '@/lib/format';

/** Status badges always carry text (never colour alone). */
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

const FINAL = new Set(['DEMO_DELIVERED', 'DEMO_PICKED_UP', 'DEMO_COLLECTED']);
export function OrderBadge({ status }: { status: DemoOrderStatus }) {
  const tone: keyof typeof TONE = status === 'DEMO_CANCELLED' ? 'bad' : FINAL.has(status) ? 'good' : status.includes('READY') ? 'info' : status === 'DEMO_PREPARING' ? 'neutral' : 'warn';
  return <Badge tone={tone}>{ORDER_STATUS_BN[status] ?? status}</Badge>;
}

/** Big number tile for the dashboard; becomes a link when `href` is given. */
export function Stat({ label, value, href, tone }: { label: string; value: React.ReactNode; href?: string; tone?: 'warn' | 'bad' }) {
  const inner = (
    <>
      <span className="block text-sm text-muted">{label}</span>
      <span className={`block text-2xl font-bold ${tone === 'warn' ? 'text-warning' : tone === 'bad' ? 'text-danger' : 'text-brand-700'}`}>{value}</span>
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-transform hover:-translate-y-0.5">
      {inner}
    </Link>
  ) : (
    <div className="card p-4">{inner}</div>
  );
}

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
