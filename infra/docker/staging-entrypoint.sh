#!/bin/sh
# Free-tier staging entrypoint (see docs/FREE_STAGING.md). NOT used for production.
#   1. applies committed Prisma migrations (idempotent; `migrate deploy` never drops or resets anything)
#   2. optionally imports the product catalogue               (STAGING_IMPORT_CATALOGUE=true)
#   3. optionally applies the owner's outlet/setup file       (STAGING_SETUP_FILE=/path)
#   4. optionally creates the first admin                     (STAGING_ADMIN_EMAIL + STAFF_PASSWORD)
#   5. starts the API
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

if [ "${STAGING_IMPORT_CATALOGUE:-}" = "true" ]; then
  echo "[staging] importing the product catalogue (idempotent; products start hidden and unpriced)"
  node dist/cli/import-catalogue.js ${STAGING_ACTIVATE_CATALOGUE:+--activate} || echo "[staging] catalogue import skipped"
fi

if [ -n "${STAGING_SETUP_FILE:-}" ] && [ -f "$STAGING_SETUP_FILE" ]; then
  echo "[staging] applying owner setup file"
  node dist/cli/setup.js --file "$STAGING_SETUP_FILE" || echo "[staging] setup step skipped"
fi

if [ -n "${STAGING_ADMIN_EMAIL:-}" ] && [ -n "${STAFF_PASSWORD:-}" ]; then
  echo "[staging] ensuring the first admin exists"
  node dist/cli/create-staff.js --role admin --email "$STAGING_ADMIN_EMAIL" --name "${STAGING_ADMIN_NAME:-Staging Admin}" || echo "[staging] admin step skipped (already exists or rejected)"
fi

echo "[staging] starting API"
exec node dist/main.js
