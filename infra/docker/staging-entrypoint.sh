#!/bin/sh
# Free-tier staging entrypoint (see docs/FREE_STAGING.md). NOT used for production.
#   1. applies committed Prisma migrations (idempotent; `migrate deploy` never drops or resets anything)
#   2. optionally loads the labelled DEMO catalogue          (STAGING_SEED_DEMO=true)
#   3. optionally creates the first Super Admin               (STAGING_ADMIN_EMAIL + SUPER_ADMIN_PASSWORD)
#   4. starts the API
# Secrets are read from the environment and never printed.
set -eu
cd /repo/apps/api

if [ "${NODE_ENV:-}" = "production" ]; then
  echo "staging-entrypoint refuses to run with NODE_ENV=production" >&2
  exit 1
fi
: "${DATABASE_URL:?DATABASE_URL is required}"

# Prisma's schema engine verifies the server certificate only with sslaccept=strict + a CA file.
MIGRATE_URL="$DATABASE_URL"
if [ -n "${DATABASE_CA_CERT:-}" ]; then
  printf '%s' "$DATABASE_CA_CERT" | sed 's/\\n/\n/g' > /tmp/db-ca.crt
  MIGRATE_URL=$(node -e '
    const u = new URL(process.env.DATABASE_URL);
    for (const k of [...u.searchParams.keys()]) if (/^ssl/i.test(k)) u.searchParams.delete(k);
    u.searchParams.set("sslmode", "require");
    u.searchParams.set("sslaccept", "strict");
    u.searchParams.set("sslcert", "/tmp/db-ca.crt");
    process.stdout.write(u.toString());
  ')
fi

echo "[staging] applying migrations"
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy

if [ "${STAGING_SEED_DEMO:-}" = "true" ]; then
  echo "[staging] loading demo catalogue (idempotent)"
  node dist/seed/demo/demo-seed.js seed
fi

if [ -n "${STAGING_ADMIN_EMAIL:-}" ] && [ -n "${SUPER_ADMIN_PASSWORD:-}" ]; then
  echo "[staging] ensuring first Super Admin exists"
  node dist/cli/create-super-admin.js --email "$STAGING_ADMIN_EMAIL" --name "${STAGING_ADMIN_NAME:-Staging Admin}" || echo "[staging] super admin step skipped (already exists or rejected)"
fi

echo "[staging] starting API"
exec node dist/main.js
