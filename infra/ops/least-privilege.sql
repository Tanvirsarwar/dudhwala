-- Least-privilege database access for Dudhwala (staging and production).
-- NOT run automatically by anything in this repository.
--
-- Model
--   migration owner : the role that runs `prisma migrate deploy` and owns the tables
--                     (on Supabase: the `postgres` role). Used only for releases.
--   app role        : what the running API connects as. Data manipulation only
--                     (SELECT/INSERT/UPDATE/DELETE); no DDL, not an owner, no BYPASSRLS.
--   Data API roles  : Supabase's anon / authenticated / service_role (skipped when absent).
--                     The API never uses them, so all access is removed.
--
-- Usage (run as the migration owner, after the first `migrate deploy`, and again after
-- any release that adds tables only if the default-privilege step below was skipped):
--
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v app_role=dw_app -v app_password='<generated, not committed>' \
--        -f infra/ops/least-privilege.sql
--
-- Do not enable row-level security on these tables while the API connects as the
-- app role: RLS without policies would deny the app itself. Access control here is
-- the grant set below plus the Data API being switched off (docs/DEPLOY_VERCEL_SUPABASE.md §2).

\set ON_ERROR_STOP on

-- 1. App role (created once; an existing role keeps its password).
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS', :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role') \gexec

SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), :'app_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'app_role') \gexec

-- 2. Data manipulation on every current table. UUID keys everywhere: no sequences to grant.
SELECT format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', :'app_role') \gexec
-- Prisma's own bookkeeping table is not the app's business.
SELECT format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', :'app_role')
WHERE to_regclass('public._prisma_migrations') IS NOT NULL \gexec

-- 3. Tables created by future migrations (run by this same owner) get the same grants automatically.
SELECT format('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', :'app_role') \gexec

-- 4. Remove Supabase Data API access (no-op when those roles do not exist).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
