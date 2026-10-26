'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useAction, useLoad } from '@/lib/use-load';
import { poishaToInput, slot, taka, todayDhaka, toPoisha, WEEKDAYS } from '@/lib/format';
import { slugify } from '@/lib/catalog';
import { Badge, Empty, Field, Loading, Modal, Msg, NeedOutlet, PageTitle, TableWrap } from '@/components/ui';

interface Area {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  active: boolean;
}
interface Zone {
  id: string;
  name: string;
  active: boolean;
  areas: { area: Area }[];
}
interface Rule {
  zoneId: string;
  active: boolean;
  priority: number;
  deliveryFeePoisha: number;
  freeDeliveryMinPoisha: number | null;
  minOrderPoisha: number;
  codEnabled: boolean;
  codMaxOrderPoisha: number | null;
  zone: Zone;
}
interface Template {
  id: string;
  weekday: number;
  startsAt: string;
  endsAt: string;
  capacity: number;
  cutoffMinutes: number;
  active: boolean;
}
interface SlotRow {
  id: string;
  startsAt: string;
  endsAt: string;
  cutoffAt: string;
  capacity: number;
  bookedCount: number;
  status: string;
}

type Tab = 'areas' | 'rules' | 'slots';

export default function DeliveryPage() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>(s.outletId ? 'slots' : 'areas');
  return (
    <>
      <PageTitle title="ডেলিভারি ও স্লট" />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="ডেলিভারি সেটআপ">
        {(
          [
            ['areas', 'এলাকা ও জোন'],
            ['rules', 'আউটলেটের ফি ও COD'],
            ['slots', 'ডেলিভারি স্লট'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'areas' ? <AreasZones /> : null}
      {tab === 'rules' ? s.outletId ? <Rules outletId={s.outletId} /> : <NeedOutlet /> : null}
      {tab === 'slots' ? s.outletId ? <Slots outletId={s.outletId} /> : <NeedOutlet /> : null}
    </>
  );
}

function AreasZones() {
  const s = useSession();
  const canManage = s.can('delivery.zones_manage');
  const areas = useLoad<Area[]>('/admin/areas');
  const zones = useLoad<Zone[]>('/admin/zones');
  const [areaOpen, setAreaOpen] = useState<Area | 'new' | null>(null);
  const [zoneOpen, setZoneOpen] = useState<Zone | 'new' | null>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-4" aria-labelledby="h-areas">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="h-areas" className="font-semibold">
            এলাকা
          </h2>
          {canManage ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setAreaOpen('new')}>
              নতুন এলাকা
            </button>
          ) : null}
        </div>
        <p className="mb-2 text-xs text-muted">গ্রাহক চেকআউটে যে এলাকার নাম দেখেন। কোনো জোনে না থাকলে সেখানে ডেলিভারি হয় না।</p>
        {!areas.data ? (
          <Loading error={areas.error} />
        ) : areas.data.length === 0 ? (
          <Empty>কোনো এলাকা নেই।</Empty>
        ) : (
          <ul className="space-y-1 text-sm">
            {areas.data.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2">
                <span>
                  {a.nameBn} <span className="font-latin text-xs text-muted">{a.slug}</span> {a.active ? null : <Badge>নিষ্ক্রিয়</Badge>}
                </span>
                {canManage ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setAreaOpen(a)}>
                    সম্পাদনা
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card p-4" aria-labelledby="h-zones">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="h-zones" className="font-semibold">
            জোন
          </h2>
          {canManage ? (
            <button className="btn btn-ghost btn-sm" onClick={() => setZoneOpen('new')}>
              নতুন জোন
            </button>
          ) : null}
        </div>
        <p className="mb-2 text-xs text-muted">কয়েকটি এলাকার গুচ্ছ। প্রতিটি আউটলেট জোন অনুযায়ী ফি ও COD নির্ধারণ করে।</p>
        {!zones.data ? (
          <Loading error={zones.error} />
        ) : zones.data.length === 0 ? (
          <Empty>কোনো জোন নেই।</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {zones.data.map((z) => (
              <li key={z.id} className="flex items-start justify-between gap-2">
                <span>
                  <strong>{z.name}</strong> {z.active ? null : <Badge>নিষ্ক্রিয়</Badge>}
                  <span className="block text-muted">{z.areas.map((x) => x.area.nameBn).join(', ') || 'কোনো এলাকা নেই'}</span>
                </span>
                {canManage ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setZoneOpen(z)}>
                    সম্পাদনা
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {areaOpen ? <AreaDialog area={areaOpen === 'new' ? null : areaOpen} onClose={() => setAreaOpen(null)} onDone={areas.reload} /> : null}
      {zoneOpen ? <ZoneDialog zone={zoneOpen === 'new' ? null : zoneOpen} areas={areas.data ?? []} onClose={() => setZoneOpen(null)} onDone={zones.reload} /> : null}
    </div>
  );
}

function AreaDialog({ area, onClose, onDone }: { area: Area | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [nameBn, setNameBn] = useState(area?.nameBn ?? '');
  const [nameEn, setNameEn] = useState(area?.nameEn ?? '');
  const [slug, setSlug] = useState(area?.slug ?? '');
  const [active, setActive] = useState(area?.active ?? true);
  const a = useAction();
  const effSlug = slug || slugify(nameEn);
  return (
    <Modal open title={area ? 'এলাকা সম্পাদনা' : 'নতুন এলাকা'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = { nameBn, nameEn: nameEn || null, slug: effSlug, active };
          void a.run(() => (area ? api(`/admin/areas/${area.id}`, { method: 'PATCH', body }) : api('/admin/areas', { body }))).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <Field label="নাম (বাংলা)" id="a-bn">
          <input id="a-bn" className="field" value={nameBn} onChange={(e) => setNameBn(e.target.value)} required />
        </Field>
        <Field label="নাম (English)" id="a-en">
          <input id="a-en" className="field" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label="স্লাগ" id="a-slug">
          <input id="a-slug" className="field font-latin" value={effSlug} onChange={(e) => setSlug(e.target.value)} required />
        </Field>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> সক্রিয়
        </label>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || !nameBn || !effSlug}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}

function ZoneDialog({ zone, areas, onClose, onDone }: { zone: Zone | null; areas: Area[]; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(zone?.name ?? '');
  const [active, setActive] = useState(zone?.active ?? true);
  const [picked, setPicked] = useState<Set<string>>(new Set(zone?.areas.map((x) => x.area.id) ?? []));
  const a = useAction();
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <Modal open title={zone ? 'জোন সম্পাদনা' : 'নতুন জোন'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = { name, active, areaIds: [...picked] };
          void a.run(() => (zone ? api(`/admin/zones/${zone.id}`, { method: 'PUT', body }) : api('/admin/zones', { body }))).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <Field label="জোনের নাম" id="z-name">
          <input id="z-name" className="field" value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <fieldset className="mb-3 max-h-56 overflow-y-auto">
          <legend className="label">এলাকা</legend>
          {areas.map((ar) => (
            <label key={ar.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={picked.has(ar.id)} onChange={() => toggle(ar.id)} /> {ar.nameBn}
            </label>
          ))}
        </fieldset>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> সক্রিয়
        </label>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || !name}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}

function Rules({ outletId }: { outletId: string }) {
  const s = useSession();
  const canManage = s.can('delivery.outlet_rules_manage');
  const rules = useLoad<Rule[]>(`/admin/outlets/${outletId}/zone-rules`);
  const zones = useLoad<Zone[]>('/admin/zones');
  const [editing, setEditing] = useState<{ zone: Zone; rule: Rule | null } | null>(null);
  if (!rules.data || !zones.data) return <Loading error={rules.error ?? zones.error} />;
  return (
    <>
      <p className="mb-3 text-sm text-muted">এই আউটলেট কোন জোনে ডেলিভারি দেবে, কত ফি, ন্যূনতম অর্ডার এবং ক্যাশ অন ডেলিভারি চালু কিনা। কোনো নিয়ম না থাকলে সেই জোনে এই আউটলেট থেকে ডেলিভারি হয় না।</p>
      {zones.data.length === 0 ? <Empty>আগে “এলাকা ও জোন” ট্যাবে জোন তৈরি করুন।</Empty> : null}
      <TableWrap label="জোন অনুযায়ী নিয়ম">
        <table className="tbl">
          <thead>
            <tr>
              <th>জোন</th>
              <th>অবস্থা</th>
              <th className="text-right">ফি</th>
              <th className="text-right">ফ্রি ডেলিভারি</th>
              <th className="text-right">ন্যূনতম অর্ডার</th>
              <th>COD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zones.data.map((z) => {
              const r = rules.data?.find((x) => x.zoneId === z.id) ?? null;
              return (
                <tr key={z.id}>
                  <td>{z.name}</td>
                  <td>{r?.active ? <Badge tone="good">ডেলিভারি চালু</Badge> : <Badge>বন্ধ</Badge>}</td>
                  <td className="text-right font-latin">{r ? taka(r.deliveryFeePoisha) : '—'}</td>
                  <td className="text-right font-latin">{r?.freeDeliveryMinPoisha != null ? `≥ ${taka(r.freeDeliveryMinPoisha)}` : '—'}</td>
                  <td className="text-right font-latin">{r ? taka(r.minOrderPoisha) : '—'}</td>
                  <td>{r ? (r.codEnabled ? `চালু${r.codMaxOrderPoisha ? ` (≤ ${taka(r.codMaxOrderPoisha)})` : ''}` : 'বন্ধ') : '—'}</td>
                  <td>
                    {canManage ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ zone: z, rule: r })}>
                        {r ? 'সম্পাদনা' : 'চালু করুন'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      {!canManage ? <p className="mt-2 text-xs text-muted">নিয়ম বদলাতে সুপার অ্যাডমিনের অনুমতি লাগে।</p> : null}
      {editing ? <RuleDialog outletId={outletId} zone={editing.zone} rule={editing.rule} onClose={() => setEditing(null)} onDone={rules.reload} /> : null}
    </>
  );
}

function RuleDialog({ outletId, zone, rule, onClose, onDone }: { outletId: string; zone: Zone; rule: Rule | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [active, setActive] = useState(rule?.active ?? true);
  const [fee, setFee] = useState(poishaToInput(rule?.deliveryFeePoisha));
  const [free, setFree] = useState(poishaToInput(rule?.freeDeliveryMinPoisha));
  const [min, setMin] = useState(poishaToInput(rule?.minOrderPoisha ?? 0));
  const [cod, setCod] = useState(rule?.codEnabled ?? false);
  const [codMax, setCodMax] = useState(poishaToInput(rule?.codMaxOrderPoisha));
  const [priority, setPriority] = useState(String(rule?.priority ?? 100));
  const a = useAction();
  const feeP = toPoisha(fee);
  const minP = toPoisha(min) ?? 0;
  return (
    <Modal open title={`নিয়ম — ${zone.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = { active, priority: Number(priority), deliveryFeePoisha: feeP, freeDeliveryMinPoisha: free.trim() ? toPoisha(free) : null, minOrderPoisha: minP, codEnabled: cod, codMaxOrderPoisha: cod && codMax.trim() ? toPoisha(codMax) : null };
          void a.run(() => api(`/admin/outlets/${outletId}/zone-rules/${zone.id}`, { method: 'PUT', body })).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> এই জোনে ডেলিভারি দিন
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="ডেলিভারি ফি (৳)" id="r-fee">
            <input id="r-fee" className="field font-latin" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} required />
          </Field>
          <Field label="এর বেশি হলে ফ্রি (৳, ঐচ্ছিক)" id="r-free">
            <input id="r-free" className="field font-latin" inputMode="decimal" value={free} onChange={(e) => setFree(e.target.value)} />
          </Field>
          <Field label="ন্যূনতম অর্ডার (৳)" id="r-min">
            <input id="r-min" className="field font-latin" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />
          </Field>
          <Field label="অগ্রাধিকার" id="r-pri" hint="একাধিক আউটলেট একই এলাকায় দিলে কম সংখ্যা আগে।">
            <input id="r-pri" type="number" min={0} max={1000} className="field font-latin" value={priority} onChange={(e) => setPriority(e.target.value)} aria-describedby="r-pri-hint" />
          </Field>
        </div>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cod} onChange={(e) => setCod(e.target.checked)} /> ক্যাশ অন ডেলিভারি চালু
        </label>
        {cod ? (
          <Field label="COD সর্বোচ্চ অর্ডার (৳, ঐচ্ছিক)" id="r-codmax">
            <input id="r-codmax" className="field font-latin" inputMode="decimal" value={codMax} onChange={(e) => setCodMax(e.target.value)} />
          </Field>
        ) : null}
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || feeP === null}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}

function Slots({ outletId }: { outletId: string }) {
  const s = useSession();
  const canManage = s.can('delivery.slots_manage');
  const templates = useLoad<Template[]>(`/admin/outlets/${outletId}/slot-templates`);
  const [date, setDate] = useState(todayDhaka());
  const slots = useLoad<SlotRow[]>(`/admin/outlets/${outletId}/slots?date=${date}`);
  const [newOpen, setNewOpen] = useState(false);
  const a = useAction();

  const hhmm = (t: string) => new Date(t).toISOString().slice(11, 16);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="card p-4" aria-labelledby="h-tpl">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="h-tpl" className="font-semibold">
            সাপ্তাহিক স্লট টেমপ্লেট
          </h2>
          {canManage ? (
            <div className="flex gap-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setNewOpen(true)}>
                নতুন টেমপ্লেট
              </button>
              <button
                className="btn btn-primary btn-sm"
                disabled={a.busy}
                onClick={() => void a.run(async () => {
                  const r = await api<{ created: number }>(`/admin/outlets/${outletId}/slots/generate`, { method: 'POST' });
                  a.setOk(`${r.created}টি নতুন স্লট তৈরি হয়েছে`);
                }).then(() => slots.reload())}
              >
                স্লট তৈরি করুন
              </button>
            </div>
          ) : null}
        </div>
        <p className="mb-2 text-xs text-muted">টেমপ্লেট থেকে আগামী দিনগুলোর স্লট তৈরি হয় (প্রতিদিন স্বয়ংক্রিয়ভাবেও)। কাট-অফ: স্লট শুরুর কত মিনিট আগে অর্ডার বন্ধ।</p>
        <Msg error={a.error} ok={a.ok} />
        {!templates.data ? (
          <Loading error={templates.error} />
        ) : templates.data.length === 0 ? (
          <Empty>কোনো টেমপ্লেট নেই — গ্রাহকরা এই আউটলেট থেকে ডেলিভারি সময় বাছতে পারবেন না।</Empty>
        ) : (
          <TableWrap label="স্লট টেমপ্লেট">
            <table className="tbl">
              <thead>
                <tr>
                  <th>দিন</th>
                  <th>সময়</th>
                  <th className="text-right">ধারণক্ষমতা</th>
                  <th className="text-right">কাট-অফ</th>
                  <th>অবস্থা</th>
                </tr>
              </thead>
              <tbody>
                {templates.data.map((t) => (
                  <tr key={t.id}>
                    <td>{WEEKDAYS[t.weekday]}</td>
                    <td className="font-latin">
                      {hhmm(t.startsAt)}–{hhmm(t.endsAt)}
                    </td>
                    <td className="text-right font-latin">{t.capacity}</td>
                    <td className="text-right font-latin">{t.cutoffMinutes} মি.</td>
                    <td>
                      {canManage ? (
                        <button className="btn btn-ghost btn-sm" onClick={() => void a.run(() => api(`/admin/outlets/${outletId}/slot-templates/${t.id}`, { method: 'PATCH', body: { active: !t.active } })).then(() => templates.reload())}>
                          {t.active ? 'চালু — বন্ধ করুন' : 'বন্ধ — চালু করুন'}
                        </button>
                      ) : t.active ? (
                        'চালু'
                      ) : (
                        'বন্ধ'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>

      <section className="card p-4" aria-labelledby="h-slots">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="h-slots" className="font-semibold">
            দিনের স্লট
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">তারিখ</span>
            <input type="date" className="field field-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        {!slots.data ? (
          <Loading error={slots.error} />
        ) : slots.data.length === 0 ? (
          <Empty>এই দিনে কোনো স্লট নেই।</Empty>
        ) : (
          <TableWrap label="দিনের স্লট">
            <table className="tbl">
              <thead>
                <tr>
                  <th>সময়</th>
                  <th className="text-right">বুকড / ধারণক্ষমতা</th>
                  <th>অবস্থা</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {slots.data.map((x) => (
                  <SlotLine key={x.id} outletId={outletId} slotRow={x} canManage={canManage} onDone={slots.reload} />
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </section>
      {newOpen ? <TemplateDialog outletId={outletId} onClose={() => setNewOpen(false)} onDone={templates.reload} /> : null}
    </div>
  );
}

function SlotLine({ outletId, slotRow, canManage, onDone }: { outletId: string; slotRow: SlotRow; canManage: boolean; onDone: () => Promise<void> }) {
  const [cap, setCap] = useState(String(slotRow.capacity));
  const a = useAction();
  const patch = (body: Record<string, unknown>) => void a.run(() => api(`/admin/outlets/${outletId}/slots/${slotRow.id}`, { method: 'PATCH', body })).then((ok) => (ok ? onDone() : undefined));
  return (
    <tr>
      <td className="font-latin">{slot(slotRow.startsAt, slotRow.endsAt).slice(11)}</td>
      <td className="text-right font-latin">
        {slotRow.bookedCount} /{' '}
        {canManage ? (
          <input aria-label="ধারণক্ষমতা" type="number" min={Math.max(1, slotRow.bookedCount)} className="field field-sm inline-block w-20" value={cap} onChange={(e) => setCap(e.target.value)} onBlur={() => Number(cap) !== slotRow.capacity && patch({ capacity: Number(cap) })} />
        ) : (
          slotRow.capacity
        )}
      </td>
      <td>{slotRow.status === 'OPEN' ? <Badge tone="good">খোলা</Badge> : <Badge>বন্ধ</Badge>}</td>
      <td>
        {canManage ? (
          <button className="btn btn-ghost btn-sm" disabled={a.busy} onClick={() => patch({ status: slotRow.status === 'OPEN' ? 'CLOSED' : 'OPEN' })}>
            {slotRow.status === 'OPEN' ? 'বন্ধ করুন' : 'খুলুন'}
          </button>
        ) : null}
        {a.error ? <span className="block text-xs text-danger">{a.error}</span> : null}
      </td>
    </tr>
  );
}

function TemplateDialog({ outletId, onClose, onDone }: { outletId: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [days, setDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4, 5, 6]));
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('12:00');
  const [capacity, setCapacity] = useState('10');
  const [cutoff, setCutoff] = useState('120');
  const a = useAction();
  return (
    <Modal open title="নতুন স্লট টেমপ্লেট" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void a.run(async () => {
            for (const weekday of [...days].sort()) {
              await api(`/admin/outlets/${outletId}/slot-templates`, { body: { weekday, startsAt: start, endsAt: end, capacity: Number(capacity), cutoffMinutes: Number(cutoff), active: true } });
            }
          }).then(async (ok) => {
            if (ok) {
              await onDone();
              onClose();
            }
          });
        }}
      >
        <fieldset className="mb-3">
          <legend className="label">দিন</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={days.has(i)}
                  onChange={() =>
                    setDays((p) => {
                      const n = new Set(p);
                      if (n.has(i)) n.delete(i);
                      else n.add(i);
                      return n;
                    })
                  }
                />{' '}
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <Field label="শুরু" id="t-start">
            <input id="t-start" type="time" className="field font-latin" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="শেষ" id="t-end">
            <input id="t-end" type="time" className="field font-latin" value={end} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
          <Field label="ধারণক্ষমতা (অর্ডার)" id="t-cap">
            <input id="t-cap" type="number" min={1} className="field font-latin" value={capacity} onChange={(e) => setCapacity(e.target.value)} required />
          </Field>
          <Field label="কাট-অফ (মিনিট)" id="t-cut">
            <input id="t-cut" type="number" min={0} className="field font-latin" value={cutoff} onChange={(e) => setCutoff(e.target.value)} required />
          </Field>
        </div>
        <Msg error={a.error} />
        <button className="btn btn-primary" disabled={a.busy || days.size === 0 || end <= start}>
          সংরক্ষণ
        </button>
      </form>
    </Modal>
  );
}
