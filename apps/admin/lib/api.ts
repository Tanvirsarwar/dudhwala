/**
 * API client for the admin and rider app.
 * Runs in the browser only: the staff session cookie (httpOnly, SameSite=Strict)
 * is sent with credentials: 'include'; state-changing calls carry the CSRF token.
 * No audience header: the API treats requests without one as staff requests.
 */

export const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

async function csrf(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch(`${API}/auth/csrf`, { credentials: 'include' });
  csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  return csrfToken;
}

type Init = { method?: string; body?: unknown };

async function send(path: string, init: Init, retried: boolean): Promise<Response> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await csrf();
  const res = await fetch(`${API}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.ok) return res;
  const data = (await res.clone().json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  // A stale CSRF cookie/token pair: fetch a fresh one and retry once.
  if (res.status === 403 && !retried && /CSRF/i.test(data.error?.message ?? '')) {
    await csrf(true);
    return send(path, init, true);
  }
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('dw:unauthenticated'));
  throw new ApiError(res.status, data.error?.code ?? 'ERROR', data.error?.message ?? `Request failed (${res.status})`, data.error?.details);
}

export async function api<T = unknown>(path: string, init: Init = {}): Promise<T> {
  const res = await send(path, init, false);
  if (res.status === 204) return undefined as T;
  return (await res.json().catch(() => undefined)) as T;
}

export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
