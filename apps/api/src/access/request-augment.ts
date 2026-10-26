import type { Principal } from './principal.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requestIdMiddleware on every request. */
      requestId: string;
      /** Set by AccessGuard when a valid session cookie is present. */
      principal?: Principal;
    }
  }
}

export {};
