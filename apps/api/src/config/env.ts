import { z } from 'zod';

const base64Key32 = z
  .string()
  .min(1)
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_ORIGIN: z.string().url(),
    ADMIN_ORIGIN: z.string().url(),
    API_PUBLIC_URL: z.string().url(),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    OTP_HMAC_KEY: z.string().min(32),
    DATA_ENCRYPTION_KEY: base64Key32,
    DATA_ENCRYPTION_KEY_ID: z.string().min(1).default('k1'),
    MEDIA_STORAGE: z.enum(['local', 's3']).default('local'),
    MEDIA_DIR: z.string().default('./var/media'),
    MEDIA_PUBLIC_URL: z.string().default(''),
    STORAGE_ENDPOINT: z.string().default(''),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: z.string().default(''),
    STORAGE_ACCESS_KEY_ID: z.string().default(''),
    STORAGE_SECRET_ACCESS_KEY: z.string().default(''),
    PAYMENTS_PROVIDER: z.enum(['fake', 'sslcommerz']).default('fake'),
    SSLCOMMERZ_STORE_ID: z.string().default(''),
    SSLCOMMERZ_STORE_PASSWORD: z.string().default(''),
    SSLCOMMERZ_LIVE: z.enum(['true', 'false']).default('false'),
    PAYMENTS_WEBHOOK_SECRET: z.string().min(32).default('dev-only-payments-webhook-secret-0123456789'),
    ALLOW_PAYMENT_SIMULATOR: z.enum(['true', 'false']).default('false'),
    SMS_PROVIDER: z.enum(['log', 'http']).default('log'),
    SMS_HTTP_URL: z.string().default(''),
    SMS_HTTP_METHOD: z.enum(['GET', 'POST']).default('POST'),
    SMS_HTTP_STATIC_PARAMS: z.string().default(''),
    SMS_HTTP_TO_PARAM: z.string().default('number'),
    SMS_HTTP_TEXT_PARAM: z.string().default('message'),
    SMS_HTTP_PHONE_FORMAT: z.enum(['e164', '880', '0']).default('880'),
    SMS_HTTP_SUCCESS_PATTERN: z.string().default('.'),
    ENABLE_DEV_OUTBOX: z.enum(['true', 'false']).default('false'),
    SMS_DAILY_CAP: z.coerce.number().int().min(0).default(500),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    const live = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    if (live && !env.API_PUBLIC_URL.startsWith('https://')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['API_PUBLIC_URL'], message: 'must be https outside development' });
    }
    if (env.NODE_ENV === 'production' && env.PAYMENTS_PROVIDER === 'fake') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PAYMENTS_PROVIDER'], message: 'the payment simulator cannot run in production' });
    }
    if (env.NODE_ENV === 'staging' && env.PAYMENTS_PROVIDER === 'fake' && env.ALLOW_PAYMENT_SIMULATOR !== 'true') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ALLOW_PAYMENT_SIMULATOR'], message: 'set to true to use the payment simulator on staging' });
    }
    if (live && env.PAYMENTS_WEBHOOK_SECRET.startsWith('dev-only')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['PAYMENTS_WEBHOOK_SECRET'], message: 'set a real secret outside development' });
    }
    if (live && env.MEDIA_STORAGE !== 's3') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['MEDIA_STORAGE'], message: 'use s3 outside development (local disk is lost on redeploy)' });
    }
    if (env.MEDIA_STORAGE === 's3' && (!env.STORAGE_BUCKET || !env.STORAGE_ACCESS_KEY_ID || !env.STORAGE_SECRET_ACCESS_KEY || !env.MEDIA_PUBLIC_URL)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STORAGE_BUCKET'], message: 'bucket, keys and MEDIA_PUBLIC_URL are required for s3 media' });
    }
    if (live && env.ENABLE_DEV_OUTBOX === 'true') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['ENABLE_DEV_OUTBOX'], message: 'the dev SMS outbox exposes OTP codes and is development-only' });
    }
    if (env.PAYMENTS_PROVIDER === 'sslcommerz' && (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SSLCOMMERZ_STORE_ID'], message: 'store id and password are required for sslcommerz' });
    }
    if (env.PAYMENTS_PROVIDER === 'sslcommerz' && env.NODE_ENV === 'production' && env.SSLCOMMERZ_LIVE !== 'true') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SSLCOMMERZ_LIVE'], message: 'production must use the live SSLCOMMERZ endpoint' });
    }
    if (env.SSLCOMMERZ_LIVE === 'true' && env.NODE_ENV !== 'production') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SSLCOMMERZ_LIVE'], message: 'live payments only in production; use the sandbox elsewhere' });
    }
    if (env.SMS_PROVIDER === 'http' && !/^https:\/\//.test(env.SMS_HTTP_URL) && live) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_HTTP_URL'], message: 'an https SMS provider URL is required' });
    }
    if (env.SMS_PROVIDER === 'http' && !env.SMS_HTTP_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_HTTP_URL'], message: 'SMS_HTTP_URL is required for the http SMS provider' });
    }
    if (live && env.SMS_PROVIDER === 'log') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_PROVIDER'], message: 'log SMS provider is for local development only' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parses process env; throws with variable names only (never values). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${problems}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
