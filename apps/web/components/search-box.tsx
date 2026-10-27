'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from './icons';
import { taka } from '@/lib/format';
import { corrections, loadCatalog, rank, type Catalog } from '@/lib/catalog-search';

/**
 * Search field with live, typo-tolerant suggestions (image, name, sample price). Enter opens the highlighted
 * suggestion, or the full results page; arrow keys, Escape and touch taps work. `onQuery` lets the results page
 * filter live while typing.
 */
export function SearchBox({ initial = '', onQuery, className = '', inputClass = '', id }: { initial?: string; onQuery?: (q: string) => void; className?: string; inputClass?: string; id?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [cat, setCat] = useState<Catalog | null>(null);
  const box = useRef<HTMLFormElement>(null);
  const listId = useId();

  const hits = useMemo(() => (cat && q.trim() ? rank(cat, q).slice(0, 6) : []), [cat, q]);
  const fixes = useMemo(() => (cat && q.trim().length > 1 && hits.length === 0 ? corrections(cat, q) : []), [cat, q, hits.length]);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, []);

  const change = (v: string) => {
    setQ(v);
    setOpen(true);
    setActive(-1);
    onQuery?.(v);
    if (!cat) void loadCatalog().then(setCat, () => undefined);
  };
  const go = (slug: string) => {
    setOpen(false);
    router.push(`/p/${slug}`);
  };

  return (
    <form
      ref={box}
      action="/search"
      role="search"
      className={`relative ${className}`}
      onSubmit={(e) => {
        if (active >= 0 && hits[active]) {
          e.preventDefault();
          go(hits[active].slug);
        } else if (onQuery) {
          e.preventDefault(); // results page filters in place
          setOpen(false);
        }
      }}
    >
      <label htmlFor={id ?? `${listId}-q`} className="sr-only">
        পণ্য খুঁজুন
      </label>
      <input
        id={id ?? `${listId}-q`}
        name="q"
        type="search"
        autoComplete="off"
        value={q}
        placeholder="দুধ, দই, ঘি… খুঁজুন"
        className={inputClass}
        role="combobox"
        aria-expanded={open && (hits.length > 0 || q.trim().length > 0)}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onFocus={() => {
          setOpen(true);
          if (!cat) void loadCatalog().then(setCat, () => undefined);
        }}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits.length) {
            e.preventDefault();
            setActive((a) => (a + 1) % hits.length);
          } else if (e.key === 'ArrowUp' && hits.length) {
            e.preventDefault();
            setActive((a) => (a <= 0 ? hits.length - 1 : a - 1));
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button type="submit" className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-brand-600" aria-label="খুঁজুন">
        <SearchIcon />
      </button>
      {open && q.trim() && (
        <div id={listId} role="listbox" className="search-pop glass">
          {hits.map((p, i) => (
            <button key={p.id} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active} className="search-opt" onClick={() => go(p.slug)} onMouseEnter={() => setActive(i)}>
              {p.image && <img src={p.image.url} alt="" width={44} height={44} loading="lazy" />}
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate font-semibold">{p.nameBn}</span>
                {p.nameEn && p.nameEn !== p.nameBn && <span className="font-latin block truncate text-xs text-muted">{p.nameEn}</span>}
              </span>
              <span className="text-sm font-bold text-brand-700">{taka(p.fromPricePoisha)}</span>
            </button>
          ))}
          {cat && hits.length === 0 && (
            <div className="px-4 py-3 text-sm" role="status">
              <p className="font-semibold">কোনো মিল পাওয়া যায়নি</p>
              {fixes.length > 0 && (
                <p className="mt-1 text-muted">
                  আপনি কি বলতে চেয়েছেন:{' '}
                  {fixes.map((f) => (
                    <button key={f} type="button" className="mr-2 font-latin font-semibold text-accent-ink underline" onClick={() => change(f)}>
                      {f}
                    </button>
                  ))}
                </p>
              )}
            </div>
          )}
          {!cat && <p className="px-4 py-3 text-sm text-muted">লোড হচ্ছে…</p>}
        </div>
      )}
    </form>
  );
}
