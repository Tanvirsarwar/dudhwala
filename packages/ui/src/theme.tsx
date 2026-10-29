'use client';

import { useCallback, useEffect, useState } from 'react';
import { THEME_KEY } from './boot';

/**
 * Day / Night theme for both apps. The choice lives in localStorage ("dw.theme"); with no choice the system
 * preference decides, and follows it live. THEME_BOOT_SCRIPT runs inline in <head> before first paint, so there is no
 * flash of the wrong theme; the toggle renders neutral until mounted, so server and client markup match.
 */
export type Theme = 'light' | 'dark';

const stored = (): Theme | null => {
  try {
    const t = window.localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : null;
  } catch {
    return null;
  }
};
const system = (): Theme => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const apply = (t: Theme) => {
  document.documentElement.setAttribute('data-theme', t);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0f3a' : '#2a2fae');
};

const Sun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const Moon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

export function ThemeToggle({ className = '', onBar = false }: { className?: string; onBar?: boolean }) {
  const [theme, setTheme] = useState<Theme | null>(null); // null until mounted
  useEffect(() => {
    const sync = () => setTheme(stored() ?? system());
    sync();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      if (!stored()) {
        apply(system());
        sync();
      }
    };
    mq.addEventListener('change', onSystem);
    window.addEventListener('dw:theme', sync);
    window.addEventListener('storage', sync);
    return () => {
      mq.removeEventListener('change', onSystem);
      window.removeEventListener('dw:theme', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const choose = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* private mode: the switch still works until reload */
    }
    apply(t);
    setTheme(t);
    window.dispatchEvent(new Event('dw:theme'));
  }, []);

  const seg = (t: Theme, label: string, icon: React.ReactNode) => (
    <button type="button" className={`seg ${theme === t ? 'is-active' : ''}`} aria-pressed={theme === t} aria-label={label} title={label} onClick={() => choose(t)}>
      {icon}
    </button>
  );
  return (
    <div role="group" aria-label="থিম / Theme" className={`seg-group ${onBar ? 'on-bar' : ''} ${className}`}>
      {seg('light', 'দিন মোড', <Sun />)}
      {seg('dark', 'রাত মোড', <Moon />)}
    </div>
  );
}
