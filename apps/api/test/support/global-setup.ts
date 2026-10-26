import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Creates a fresh test database.
 * - TEST_SCHEMA_SOURCE=migrations (CI): `prisma migrate deploy` — the real migrations.
 * - default when migrations exist: applies prisma/migrations/<n>/migration.sql in order
 *   with plain SQL (same SQL as migrate deploy; works without Prisma's native engine).
 * - fallback (no migrations yet): DMMF bootstrap (scripts/dev-ddl.mjs) + constraints.sql.
 */
export default async function setup(): Promise<void> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://dw@127.0.0.1:55432/postgres';
  const dbName = process.env.TEST_DATABASE_NAME ?? 'dudhwala_test';
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  // Production-like trap: a server whose default TimeZone is not UTC (regression guard for M7 finding).
  await admin.query(`ALTER DATABASE ${dbName} SET TimeZone TO 'Asia/Dhaka'`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  process.env.TEST_DATABASE_URL = url.toString();

  if (process.env.TEST_SCHEMA_SOURCE === 'migrations') {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.toString() } });
    return;
  }
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  const dir = 'prisma/migrations';
  const migrations = existsSync(dir) ? readdirSync(dir).filter((d) => existsSync(join(dir, d, 'migration.sql'))).sort() : [];
  if (migrations.length > 0 && process.env.TEST_SCHEMA_SOURCE !== 'dev-ddl') {
    for (const m of migrations) await db.query(readFileSync(join(dir, m, 'migration.sql'), 'utf8'));
  } else {
    await db.query(execFileSync('node', ['scripts/dev-ddl.mjs'], { encoding: 'utf8' }));
    await db.query(readFileSync('prisma/sql/constraints.sql', 'utf8'));
  }
  await db.end();
}
