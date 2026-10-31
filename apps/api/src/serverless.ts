import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv } from './config/env.js';
import { createApp } from './bootstrap.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Vercel entry (see api/index.js). The Nest app is created and initialised once per warm function instance and then
 * reused; nothing listens on a port. A failed start is not cached, so the next request retries instead of serving a
 * broken instance for the rest of its life.
 */
let ready: Promise<Handler> | undefined;

function start(): Promise<Handler> {
  return (async () => {
    const app = await createApp(loadEnv());
    await app.init(); // runs module init hooks and finishes routing; does not call listen()
    return app.getHttpAdapter().getInstance() as Handler;
  })();
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    ready ??= start();
    (await ready)(req, res);
  } catch (e) {
    ready = undefined;
    // Names of missing/invalid variables only (loadEnv never prints values).
    console.error('API failed to start:', e instanceof Error ? e.message : String(e));
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'API failed to start' } }));
  }
}
