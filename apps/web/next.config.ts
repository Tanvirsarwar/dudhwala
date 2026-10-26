import type { NextConfig } from 'next';

/**
 * Image origins allowed by the CSP. Each entry must be a bare https origin (http only for localhost in development);
 * anything else (wildcards, paths, ";" or quotes that could add CSP directives) fails the build instead of widening the policy.
 */
function parseMediaOrigins(raw: string, dev: boolean): string[] {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((o) => {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new Error(`NEXT_PUBLIC_MEDIA_ORIGINS: "${o}" is not a URL`);
      }
      const ok = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) && u.origin === o && (u.protocol === 'https:' || (dev && u.protocol === 'http:' && u.hostname === 'localhost'));
      if (!ok) throw new Error(`NEXT_PUBLIC_MEDIA_ORIGINS: "${o}" must be a bare https origin such as https://media.example.com`);
      return u.origin;
    });
}

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const apiOrigin = new URL(api).origin;
// The demo seed hot-links third-party photos (docs/OPEN_DECISIONS). Allow that host outside production so demo
// images render without extra setup; production must list its own media CDN in NEXT_PUBLIC_MEDIA_ORIGINS.
const DEMO_IMAGE_ORIGIN = 'https://wellfoodonline.com';
const mediaOrigins = parseMediaOrigins(process.env.NEXT_PUBLIC_MEDIA_ORIGINS ?? '', process.env.NODE_ENV !== 'production');
if (process.env.NODE_ENV !== 'production') mediaOrigins.push(DEMO_IMAGE_ORIGIN);

// Strict CSP: scripts only from self (Next inlines a small bootstrap, so 'unsafe-inline' is needed
// for scripts until nonces are wired; no third-party scripts are loaded).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${apiOrigin} ${mediaOrigins.join(' ')}`.trim(),
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  `form-action 'self' ${apiOrigin}`,
].join('; ');

const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@dudhwala/shared'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
