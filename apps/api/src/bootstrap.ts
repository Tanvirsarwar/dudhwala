import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import { requestIdMiddleware } from './common/http.js';
import { AppModule, type AppOverrides } from './app.module.js';

/** Builds the HTTP app. Shared by main.ts and integration tests so both run identical middleware. */
export async function createApp(env: Env, overrides: AppOverrides = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env, overrides), {
    logger: env.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
  });
  app.set('trust proxy', 1); // behind the platform's load balancer: use X-Forwarded-For for req.ip
  app.disable('x-powered-by');
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      frameguard: { action: 'deny' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '64kb' });
  app.useBodyParser('urlencoded', { extended: false, limit: '8kb' }); // payment simulator form only
  app.enableCors({
    origin: [env.WEB_ORIGIN, env.ADMIN_ORIGIN],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key', 'x-request-id', 'x-dw-audience'],
  });
  app.setGlobalPrefix('v1');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('cache-control', 'no-store');
    next();
  });
  return app;
}
