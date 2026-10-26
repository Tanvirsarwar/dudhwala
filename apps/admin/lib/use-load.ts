'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';

/** Minimal data loader: GETs `path` (skips when null), exposes reload and error text. */
export function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (mine === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(errorText(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setData(undefined);
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Wraps an action: tracks busy state and turns thrown errors into a message. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      if (success) setOk(success);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, ok, run, setError, setOk };
}
