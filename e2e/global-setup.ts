import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Creates a fresh Super Admin for this run through the real CLI (the same path the
 * runbook uses), so admin tests also cover first-login MFA enrolment.
 * Skipped when E2E_SKIP_ADMIN_SETUP=1 (storefront-only runs).
 */
export default async function globalSetup(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const api = resolve(here, '../apps/api');
  await resetLoopbackLimits(api);
  if (process.env.E2E_SKIP_ADMIN_SETUP === '1') return;
  const email = `e2e-owner-${Date.now()}@example.test`;
  const password = `E2e-${Math.random().toString(36).slice(2)}-Pass!`;
  execFileSync('node', ['dist/cli/create-super-admin.js', '--email', email, '--name', 'E2E Owner'], {
    cwd: api,
    env: { ...process.env, SUPER_ADMIN_PASSWORD: password },
    stdio: 'pipe',
  });
  const out = resolve(here, '.stack/admin.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ email, password, runId: Date.now().toString(36) }));
}

/**
 * Repeated local runs would exhaust the per-IP OTP and login limits (a real production
 * protection). Clear only the loopback address's counters in the test database.
 */
async function resetLoopbackLimits(apiDir: string): Promise<void> {
  let url = process.env.DATABASE_URL;
  if (!url) {
    try {
      url = /^DATABASE_URL=(.*)$/m.exec(readFileSync(resolve(apiDir, '.env'), 'utf8'))?.[1]?.trim().replace(/^"|"$/g, '');
    } catch {
      return;
    }
  }
  if (!url || process.env.NODE_ENV === 'production') return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DELETE FROM otp_challenge WHERE ip IN ('127.0.0.1', '::1', '::ffff:127.0.0.1')`);
    await client.query(`DELETE FROM rate_limit_bucket WHERE key LIKE '%:127.0.0.1' OR key LIKE '%:::1' OR key LIKE '%:::ffff:127.0.0.1'`);
  } finally {
    await client.end();
  }
}
