/**
 * API client for the storefront.
 * - Server components call public, cacheable endpoints via API_INTERNAL_URL.
 * - Browser code calls the API directly with cookies (credentials: include),
 *   the CSRF token from /auth/csrf, and `x-dw-audience: customer` so a staff
 *   cookie in the same browser is never used for shopping.
 */

export const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
// Server components need an absolute URL. In same-origin mode (NEXT_PUBLIC_API_URL="/v1") that is API_INTERNAL_URL,
// or the proxy target plus the same path.
const SERVER_API = process.env.API_INTERNAL_URL ?? (PUBLIC_API.startsWith('/') && process.env.API_PROXY_TARGET ? `${process.env.API_PROXY_TARGET}${PUBLIC_API}` : PUBLIC_API);

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

/** Server-side fetch of public data. Returns null on 404 so pages can call notFound(). */
// The local demo has an admin that edits data live, so its pages must never serve a cached copy of the catalogue.
const NO_CACHE = process.env.NEXT_PUBLIC_DEMO_BRANDING === '1';

export async function serverGet<T>(path: string, revalidate = 30): Promise<T | null> {
  if (SERVER_API.startsWith('/')) throw new Error('API_INTERNAL_URL (or API_PROXY_TARGET) must be set: server-side requests need an absolute API URL');
  const res = await fetch(`${SERVER_API}${path}`, { ...(NO_CACHE ? { cache: 'no-store' as const } : { next: { revalidate } }), headers: { 'x-dw-audience': 'customer' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

/** Customer-facing Bangla text for API error codes (the API's own messages are English, for logs and staff). */
const BN_ERRORS: Record<string, string> = {
  RATE_LIMITED: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
  OTP_INVALID: 'কোডটি সঠিক নয়।',
  OTP_EXPIRED: 'কোডের মেয়াদ শেষ। নতুন কোড নিন।',
  UNAUTHENTICATED: 'অনুগ্রহ করে আবার প্রবেশ করুন।',
  FORBIDDEN: 'এই কাজের অনুমতি নেই।',
  NOT_FOUND: 'খুঁজে পাওয়া যায়নি।',
  VALIDATION_FAILED: 'তথ্যগুলো আবার দেখে নিন — কিছু একটা সঠিক নয়।',
  SLOT_FULL: 'এই ডেলিভারি সময়টি পূর্ণ হয়ে গেছে। অন্য সময় বেছে নিন।',
  OUT_OF_STOCK: 'দুঃখিত, কিছু পণ্য এখন স্টকে নেই।',
  COUPON_INVALID: 'কুপনটি প্রযোজ্য নয়।',
  AREA_NOT_SERVICEABLE: 'এই এলাকায় এখন ডেলিভারি দেওয়া হচ্ছে না।',
  MIN_ORDER_NOT_MET: 'ন্যূনতম অর্ডারের পরিমাণ পূরণ হয়নি।',
  COD_NOT_ELIGIBLE: 'এই অর্ডারে ক্যাশ অন ডেলিভারি নেওয়া যাচ্ছে না।',
  PRICE_CHANGED: 'কিছু পণ্যের দাম বদলেছে। কার্ট আবার দেখে নিন।',
  PAYMENT_PROVIDER_UNAVAILABLE: 'অনলাইন পেমেন্ট এখন পাওয়া যাচ্ছে না। একটু পরে চেষ্টা করুন বা ক্যাশ অন ডেলিভারি নিন।',
  NO_SINGLE_OUTLET: 'সব পণ্য একসাথে একটি আউটলেট থেকে পাঠানো যাচ্ছে না। কার্ট থেকে কিছু পণ্য সরিয়ে দেখুন।',
  CONFLICT: 'অবস্থা বদলে গেছে। পাতাটি রিফ্রেশ করে আবার চেষ্টা করুন।',
  INVALID_TRANSITION: 'এই অর্ডারে এখন এটি করা যাবে না।',
};

let csrfToken: string | null = null;

async function csrf(force = false): Promise<string> {
  if (csrfToken && !force) return csrfToken;
  const res = await fetch(`${PUBLIC_API}/auth/csrf`, { credentials: 'include' });
  csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  return csrfToken;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, retried = false): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { 'x-dw-audience': 'customer', ...init.headers };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = await csrf();
  const res = await fetch(`${PUBLIC_API}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) {
    // A stale CSRF cookie/token pair: fetch a fresh one and retry once.
    if (res.status === 403 && !retried && /CSRF/i.test(data.error?.message ?? '')) {
      await csrf(true);
      return api<T>(path, init, true);
    }
    const code = data.error?.code ?? 'ERROR';
    // Checkout messages are already Bangla; English ones (meant for logs/staff) are replaced by code.
    const serverText = data.error?.message ?? '';
    const text = /[\u0980-\u09FF]/.test(serverText) ? serverText : (BN_ERRORS[code] ?? 'কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন');
    throw new ApiError(res.status, code, text, data.error?.details);
  }
  return data as T;
}

/** Notifies header badges etc. that the cart changed. */
export const cartChanged = () => window.dispatchEvent(new Event('dw:cart'));

import type { OuterCityStatus } from '@dudhwala/shared';

/** Whole-catalogue load: the API caps a page at 48, so fetch pages until `total` is reached. */
export async function fetchAllProducts(get: <T>(path: string) => Promise<T | null>): Promise<ProductCardData[]> {
  const out: ProductCardData[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await get<ProductList>(`/catalog/products?limit=48&page=${page}&sort=newest`);
    if (!r) break;
    out.push(...r.data);
    if (out.length >= r.total || r.data.length === 0) break;
  }
  return out;
}

// ── Shared response types ──

export interface ProductCardData {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
  categorySlug: string;
  image: { url: string; altBn: string } | null;
  /** null = price not supplied yet (never invented) */
  fromPricePoisha: number | null;
  outerCityStatus?: OuterCityStatus | null;
  inStock: boolean;
  variants: { id: string; labelBn: string; pricePoisha: number | null; compareAtPoisha: number | null; availability: 'IN_STOCK' | 'OUT_OF_STOCK' }[];
}

export interface ProductList {
  data: ProductCardData[];
  page: number;
  limit: number;
  total: number;
}

export interface Category {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
}

export interface Area {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string | null;
}

export interface CartView {
  id: string | null;
  areaId: string | null;
  couponCode: string | null;
  lines: { variantId: string; productSlug: string; nameBn: string; nameEn: string | null; labelBn: string; image: string | null; unitPricePoisha: number | null; quantity: number; lineTotalPoisha: number | null; available: boolean; maxQty: number; categorySlug?: string; outerCityStatus?: OuterCityStatus | null }[];
  subtotalPoisha: number | null;
  itemCount: number;
  warnings: { variantId: string; code: string }[];
}
