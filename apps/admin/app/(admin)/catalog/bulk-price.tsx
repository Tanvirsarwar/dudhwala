'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAction } from '@/lib/use-load';
import { taka } from '@/lib/format';
import { Field, Modal, Msg } from '@/components/ui';

interface Row {
  row: number;
  sku: string;
  ok: boolean;
  error?: string;
  beforePoisha?: number;
  afterPoisha?: number;
}
interface Report {
  applied: boolean;
  total: number;
  invalid: number;
  unchanged: number;
  rows: Row[];
}
interface CsvRow {
  sku: string;
  priceTaka: string;
  compareAtTaka?: string;
}

const MAX_ROWS = 500;

/** Minimal RFC 4180 parser (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip Excel's BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) out.push(row);
  return out;
}

export function toRows(text: string): CsvRow[] {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new Error('ফাইলটি খালি');
  const col = (name: string) => head.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const sku = col('sku');
  const price = col('priceTaka');
  const compare = col('compareAtTaka');
  if (sku < 0 || price < 0) throw new Error('"sku" ও "priceTaka" কলাম দরকার (ডাউনলোড করা ফাইলের ফরম্যাট ব্যবহার করুন)');
  // Spreadsheet-escaped cells (leading ') are cleaned so a re-uploaded export still validates.
  const clean = (v: string | undefined) => (v ?? '').trim().replace(/^'/, '');
  return body.map((r) => ({ sku: clean(r[sku]), priceTaka: clean(r[price]), ...(compare >= 0 && clean(r[compare]) ? { compareAtTaka: clean(r[compare]) } : {}) }));
}

/** Upload → preview (dry run, nothing saved) → confirm. A file with any bad row is never partially applied. */
export function BulkPrice({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const preview = useAction();
  const apply = useAction();

  const load = async (file: File | undefined) => {
    setReport(null);
    setRows(null);
    setFileError(null);
    if (!file) return;
    try {
      const parsed = toRows(await file.text());
      if (parsed.length === 0) throw new Error('ফাইলে কোনো সারি নেই');
      if (parsed.length > MAX_ROWS) throw new Error(`একবারে সর্বোচ্চ ${MAX_ROWS}টি সারি`);
      setRows(parsed);
      await preview.run(async () => setReport(await api<Report>('/admin/variants/bulk-price', { body: { dryRun: true, rows: parsed } })));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'ফাইল পড়া যায়নি');
    }
  };

  const confirm = async () => {
    if (!rows) return;
    const ok = await apply.run(async () => {
      const r = await api<Report>('/admin/variants/bulk-price', { body: { dryRun: false, rows } });
      setReport(r);
    }, 'দাম হালনাগাদ হয়েছে');
    if (ok) onDone();
  };

  const bad = report?.rows.filter((r) => !r.ok) ?? [];
  return (
    <Modal open title="CSV থেকে দাম হালনাগাদ" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">আগে "CSV নামান" দিয়ে ফাইল নিন, Excel-এ শুধু priceTaka (ও compareAtTaka) বদলান, তারপর এখানে আপলোড করুন। প্রয়োগের আগে প্রিভিউ দেখানো হবে। একটি সারিও ভুল হলে কিছুই সংরক্ষিত হয় না।</p>
      <Field label="CSV ফাইল" id="bp-file">
        <input id="bp-file" type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => void load(e.target.files?.[0])} />
      </Field>
      <Msg error={fileError ?? preview.error ?? apply.error} ok={apply.ok} />
      {preview.busy ? <p className="text-sm text-muted">যাচাই হচ্ছে…</p> : null}
      {report ? (
        <div aria-live="polite">
          <p className="mb-2 text-sm font-semibold">
            মোট {report.total}টি সারি · ভুল {report.invalid}টি · অপরিবর্তিত {report.unchanged}টি
          </p>
          {bad.length > 0 ? (
            <ul className="mb-3 max-h-48 overflow-auto rounded-lg bg-red-50 p-3 text-sm text-danger">
              {bad.map((r) => (
                <li key={r.row}>
                  সারি {r.row} ({r.sku || 'SKU নেই'}): {r.error}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mb-3 max-h-48 overflow-auto rounded-lg bg-milk p-3 text-sm">
              {report.rows
                .filter((r) => r.beforePoisha !== r.afterPoisha)
                .map((r) => (
                  <li key={r.row}>
                    <span className="font-latin">{r.sku}</span>: {taka(r.beforePoisha ?? 0)} → {taka(r.afterPoisha ?? 0)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {report?.applied ? 'বন্ধ করুন' : 'বাতিল'}
        </button>
        {report && !report.applied ? (
          <button type="button" className="btn btn-primary" onClick={() => void confirm()} disabled={apply.busy || report.invalid > 0 || report.total === report.unchanged}>
            {apply.busy ? 'প্রয়োগ হচ্ছে…' : 'প্রয়োগ করুন'}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
