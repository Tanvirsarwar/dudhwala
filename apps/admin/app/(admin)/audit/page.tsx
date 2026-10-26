'use client';

import { useState } from 'react';
import { useLoad } from '@/lib/use-load';
import { useSession } from '@/lib/session';
import { dateTime } from '@/lib/format';
import { Empty, Loading, PageTitle, TableWrap } from '@/components/ui';

interface Entry {
  id: string;
  action: string;
  actorRole: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  createdAt: string;
  actor: { fullName: string | null; email: string | null } | null;
}

/** Append-only audit trail; nobody can edit or delete entries (database-enforced). */
export default function AuditPage() {
  const s = useSession();
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const [applied, setApplied] = useState({ action: '', entityId: '' });
  const p = new URLSearchParams({ page: String(page) });
  if (applied.action) p.set('action', applied.action);
  if (applied.entityId) p.set('entityId', applied.entityId);
  if (s.outletId) p.set('outletId', s.outletId);
  const { data, error } = useLoad<Entry[]>(`/admin/audit?${p}`);
  return (
    <>
      <PageTitle title="অডিট লগ" />
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ action, entityId });
        }}
      >
        <label className="text-sm">
          <span className="label">কাজ (শুরুর অংশ)</span>
          <input className="field field-sm font-latin" placeholder="order., inventory., payment." value={action} onChange={(e) => setAction(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="label">Entity ID</span>
          <input className="field field-sm font-latin" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        </label>
        <button className="btn btn-ghost btn-sm">খুঁজুন</button>
      </form>
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <Empty>কিছু পাওয়া যায়নি।</Empty>
      ) : (
        <TableWrap label="অডিট লগ">
          <table className="tbl">
            <thead>
              <tr>
                <th>সময়</th>
                <th>কে</th>
                <th>কাজ</th>
                <th>বিষয়</th>
                <th>বিস্তারিত</th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-latin">{dateTime(e.createdAt)}</td>
                  <td>
                    {e.actor?.fullName ?? e.actor?.email ?? '—'}
                    <div className="text-xs text-muted">{e.actorRole}</div>
                  </td>
                  <td className="font-latin">{e.action}</td>
                  <td className="font-latin text-xs">
                    {e.entityType}
                    <div className="text-muted">{e.entityId}</div>
                  </td>
                  <td className="max-w-md">
                    {e.before || e.after ? (
                      <details>
                        <summary className="cursor-pointer text-sm text-brand-600">দেখুন</summary>
                        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-milk p-2 font-latin text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                      </details>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <nav aria-label="পাতা" className="mt-3 flex gap-2">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>
          আগের
        </button>
        <span className="self-center font-latin text-sm">{page}</span>
        <button className="btn btn-ghost btn-sm" disabled={(data?.length ?? 0) < 100} onClick={() => setPage((x) => x + 1)}>
          পরের
        </button>
      </nav>
    </>
  );
}
