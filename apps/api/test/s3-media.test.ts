import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../src/config/env.js';
import { MediaService, S3MediaStorage } from '../src/media/media.js';

/** A stand-in S3-compatible endpoint that records what the adapter sends (no network, no real provider). */
let server: Server;
let endpoint = '';
const seen: { method?: string; url?: string; headers: IncomingHttpHeaders; bytes: number }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let bytes = 0;
    req.on('data', (c: Buffer) => (bytes += c.length));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, bytes });
      res.writeHead(200, { etag: '"abc"' }).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/storage/v1/s3`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const env = (over: Partial<Env> = {}) =>
  ({ STORAGE_REGION: 'ap-southeast-1', STORAGE_BUCKET: 'dudhwala-media', STORAGE_ACCESS_KEY_ID: 'test-key-id', STORAGE_SECRET_ACCESS_KEY: 'test-secret', MEDIA_PUBLIC_URL: 'https://proj.supabase.co/storage/v1/object/public/dudhwala-media', ...over }) as Env;

describe('S3-compatible media adapter (Supabase Storage shape, local stand-in server)', () => {
  it('sends a path-style, SigV4-signed PUT to <endpoint>/<bucket>/<key> with type and cache headers', async () => {
    const storage = new S3MediaStorage(env({ STORAGE_ENDPOINT: endpoint }));
    await storage.put('products/abc.webp', Buffer.from('webp-bytes'), 'image/webp');
    const req = seen.at(-1)!;
    expect(req.method).toBe('PUT');
    expect(req.url?.split('?')[0]).toBe('/storage/v1/s3/dudhwala-media/products/abc.webp'); // path-style, bucket not in the hostname
    expect(req.headers['content-type']).toBe('image/webp');
    expect(req.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(req.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\/\d{8}\/ap-southeast-1\/s3\/aws4_request/);
    expect(req.bytes).toBe(10);
  });

  it('sends no aws-chunked streaming or checksum headers (rejected by several S3-compatible providers)', () => {
    const req = seen.at(-1)!;
    expect(String(req.headers['content-encoding'] ?? '')).not.toContain('aws-chunked');
    expect(req.headers['x-amz-content-sha256']).not.toMatch(/STREAMING/);
    expect(req.headers['x-amz-trailer']).toBeUndefined();
    expect(Object.keys(req.headers).filter((h) => h.startsWith('x-amz-checksum') || h === 'x-amz-sdk-checksum-algorithm')).toEqual([]);
  });

  it('builds public URLs as <MEDIA_PUBLIC_URL>/<key>, tolerating a trailing slash', () => {
    const svc = (base: string) => new MediaService(new S3MediaStorage(env({ STORAGE_ENDPOINT: endpoint, MEDIA_PUBLIC_URL: base })));
    expect(svc('https://proj.supabase.co/storage/v1/object/public/dudhwala-media').url('products/abc.webp')).toBe('https://proj.supabase.co/storage/v1/object/public/dudhwala-media/products/abc.webp');
    expect(svc('https://media.example.com/').url('/products/abc.webp')).toBe('https://media.example.com/products/abc.webp');
  });
});
