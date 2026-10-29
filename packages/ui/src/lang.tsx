'use client';

import { useEffect, useState } from 'react';
import { toEnglish } from '@dudhwala/shared';
import { LANG_KEY as KEY } from './boot';

/**
 * EN | বাংলা switch. Source text is Bangla; for English the browser swaps rendered text nodes and a few
 * attributes using the shared dictionary (packages/shared/src/i18n-*.ts). Unlisted text stays Bangla.
 * The choice is kept in localStorage, so it survives refresh and navigation.
 *
 * Constraint: this runtime rewrites text before React has hydrated streamed content. A route-level Suspense boundary
 * (e.g. a root `loading.tsx`) hydrates later than the layout effect and then fails with hydration error #418 in English.
 * Do not add `loading.tsx` above translated pages; use in-component skeletons instead (see e2e/demo/platform.cjs).
 */
export type Lang = 'bn' | 'en';
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt'] as const;

export const readLang = (): Lang => {
  try {
    return window.localStorage.getItem(KEY) === 'en' ? 'en' : 'bn';
  } catch {
    return 'bn';
  }
};

// Originals, so switching back to Bangla restores exactly what React rendered.
const textOrig = new WeakMap<Node, string>();
const attrOrig = new WeakMap<Element, Record<string, string>>();
let observer: MutationObserver | null = null;

function tText(n: Node) {
  const v = n.nodeValue ?? '';
  const t = toEnglish(v);
  if (t !== null && t !== v) {
    textOrig.set(n, v);
    n.nodeValue = t;
  }
}
function tAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const t = toEnglish(v);
    if (t !== null && t !== v) {
      attrOrig.set(el, { ...attrOrig.get(el), [a]: v });
      el.setAttribute(a, t);
    }
  }
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return tText(root);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) return;
  tAttrs(el);
  el.childNodes.forEach(walk);
}
function restore(root: Node) {
  const o = textOrig.get(root);
  if (o !== undefined) root.nodeValue = o;
  if (root.nodeType === Node.ELEMENT_NODE) {
    const el = root as Element;
    const a = attrOrig.get(el);
    if (a) for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
    el.childNodes.forEach(restore);
  }
}

function apply(lang: Lang) {
  const html = document.documentElement;
  html.lang = lang;
  observer?.disconnect();
  observer = null;
  if (lang === 'en') {
    walk(document.body);
    document.title = toEnglish(document.title) ?? document.title;
    observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') tText(m.target);
        else if (m.type === 'attributes') tAttrs(m.target as Element);
        else m.addedNodes.forEach(walk);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  } else {
    restore(document.body);
  }
  html.removeAttribute('data-lang-pending');
}

/** Mount once in the root layout. */
export function LangRuntime() {
  useEffect(() => {
    apply(readLang());
    const on = () => apply(readLang());
    window.addEventListener('dw:lang', on);
    return () => window.removeEventListener('dw:lang', on);
  }, []);
  return null;
}


export function LangToggle({ className = '', onBar = false }: { className?: string; onBar?: boolean }) {
  const [lang, setLang] = useState<Lang>('bn');
  useEffect(() => {
    setLang(readLang());
    const on = () => setLang(readLang());
    window.addEventListener('dw:lang', on);
    return () => window.removeEventListener('dw:lang', on);
  }, []);
  const choose = (l: Lang) => {
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      /* private mode: the switch still works until reload */
    }
    setLang(l);
    window.dispatchEvent(new Event('dw:lang'));
  };
  const btn = (l: Lang, label: string) => (
    <button type="button" onClick={() => choose(l)} aria-pressed={lang === l} lang={l} className={`seg ${lang === l ? 'is-active' : ''}`}>
      {label}
    </button>
  );
  return (
    <div role="group" aria-label="Language / ভাষা" className={`seg-group ${onBar ? 'on-bar' : ''} ${className}`}>
      {btn('en', 'EN')}
      {btn('bn', 'বাংলা')}
    </div>
  );
}
