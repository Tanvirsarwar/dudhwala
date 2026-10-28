'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import type { AdminCategory } from '@/lib/types';
import { useAction, useLoad } from '@/lib/use-load';
import { Field, Loading, Modal, Msg, PageTitle, TableWrap } from '@/components/ui';

function Row({ c, canEdit, onSaved }: { c: AdminCategory; canEdit: boolean; onSaved: () => void }) {
  const [v, setV] = useState({ nameBn: c.nameBn, nameEn: c.nameEn, active: c.active, sortOrder: String(c.sortOrder + 1) });
  const a = useAction();
  const dirty = v.nameBn !== c.nameBn || v.nameEn !== c.nameEn || v.active !== c.active || v.sortOrder !== String(c.sortOrder + 1);
  return (
    <tr>
      <td>
        <input aria-label="ক্রম" className="field field-sm w-16 font-latin" inputMode="numeric" value={v.sortOrder} disabled={!canEdit} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
      </td>
      <td>
        <input aria-label="নাম (বাংলা)" className="field field-sm min-w-40" value={v.nameBn} disabled={!canEdit} onChange={(e) => setV({ ...v, nameBn: e.target.value })} />
      </td>
      <td>
        <input aria-label="নাম (English)" className="field field-sm min-w-40 font-latin" value={v.nameEn} disabled={!canEdit} onChange={(e) => setV({ ...v, nameEn: e.target.value })} />
      </td>
      <td>{c.productCount}</td>
      <td>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={v.active} disabled={!canEdit} onChange={(e) => setV({ ...v, active: e.target.checked })} /> <span>দোকানে দেখান</span>
        </label>
      </td>
      <td>
        {canEdit && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!dirty || a.busy}
            aria-busy={a.busy}
            onClick={() => void a.run(async () => { await api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { nameBn: v.nameBn, nameEn: v.nameEn, active: v.active, sortOrder: Math.max(0, Number(v.sortOrder) - 1) } }); onSaved(); })}
          >
            সংরক্ষণ
          </button>
        )}
        {a.error && <p role="alert" className="mt-1 text-xs text-danger">{a.error}</p>}
      </td>
    </tr>
  );
}

export default function CategoriesPage() {
  const { canEdit } = useSession();
  const { data, error, reload } = useLoad<AdminCategory[]>('/admin/categories');
  const [adding, setAdding] = useState(false);
  const [nn, setNn] = useState({ nameBn: '', nameEn: '' });
  const add = useAction();
  if (!data) return <Loading error={error} />;
  return (
    <>
      <PageTitle title="ক্যাটাগরি">
        {canEdit && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
            + নতুন ক্যাটাগরি
          </button>
        )}
      </PageTitle>
      <p className="mb-2 text-sm text-muted">ক্রম অনুযায়ী দোকানের ক্যাটাগরি বার সাজানো হয়। "দোকানে দেখান" বন্ধ করলে ওই ক্যাটাগরির সব পণ্য দোকান থেকে লুকিয়ে যায়।</p>
      <TableWrap label="ক্যাটাগরির তালিকা">
        <table className="tbl">
          <thead>
            <tr>
              <th>ক্রম</th>
              <th>নাম (বাংলা)</th>
              <th>নাম (English)</th>
              <th>পণ্য</th>
              <th>অবস্থা</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <Row key={`${c.id}-${c.nameBn}-${c.nameEn}-${c.active}-${c.sortOrder}`} c={c} canEdit={canEdit} onSaved={() => void reload()} />
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Modal open={adding} title="নতুন ক্যাটাগরি" onClose={() => setAdding(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void add.run(async () => { await api('/admin/categories', { body: nn }); setNn({ nameBn: '', nameEn: '' }); setAdding(false); await reload(); });
          }}
        >
          <Field label="নাম (বাংলা)" id="nc-bn">
            <input id="nc-bn" className="field" value={nn.nameBn} onChange={(e) => setNn({ ...nn, nameBn: e.target.value })} required />
          </Field>
          <Field label="নাম (English)" id="nc-en">
            <input id="nc-en" className="field font-latin" value={nn.nameEn} onChange={(e) => setNn({ ...nn, nameEn: e.target.value })} required />
          </Field>
          <Msg error={add.error} />
          <button className="btn btn-primary w-full" disabled={add.busy || !nn.nameBn || !nn.nameEn}>
            তৈরি করুন
          </button>
        </form>
      </Modal>
    </>
  );
}
