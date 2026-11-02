# Supabase SQL: set up the database, then connect Vercel

All SQL is in `supabase/`. Run the files in the **Supabase SQL Editor** (Project → SQL Editor → New query → paste → Run), in this order, on a **brand-new Supabase project**.

| # | File | What it does |
|---|---|---|
| 1 | `supabase/01-schema.sql` | Creates every table, type, index and rule, turns on Row Level Security everywhere, and records Prisma's migration history as applied. **Stops with an error if the database already has tables**, so it cannot wipe data. |
| 2 | `supabase/02-catalogue-seed.sql` | 3 categories and 59 products (names and Outer Sylhet marks only). Hidden and unpriced. Safe to run twice. |
| 3 | `supabase/03-owner-setup.template.sql` | Template for your real outlet(s), opening hours, the two outlet roles and delivery fees. Replace every `REPLACE_ME` first. Nothing invented. |
| 4 | one `INSERT` for the first admin | Made on your computer, see below. |

Tested locally on PostgreSQL 16: the schema from `01` is identical (columns, indexes, constraints, RLS) to applying the six Prisma migrations in order; `02` and `03` run twice without duplicating. **Not tested on a real Supabase project.**

## Create the first admin (needs your computer)
The password must be hashed with Argon2id, which SQL cannot do. In the repo, with Node 22 and `pnpm install` done:
```bash
cd apps/api
STAFF_PASSWORD='a long password, 12+ characters' node scripts/staff-insert-sql.mjs admin you@example.com "Your Name" 
```
It prints one `INSERT INTO "user" …` statement containing only the hash. Paste it into the SQL Editor and run it. Use `manager` instead of `admin` for a view-only account. Then log in at the admin site: it forces you to set up two-factor authentication first.

## Connect Vercel to Supabase
1. Supabase → **Connect** → **Transaction pooler** (port **6543**). Copy the URI; it looks like `postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:6543/postgres`. Put your database password in place of `<PASSWORD>`. If the password has special characters, URL-encode them.
2. Vercel → API project → Settings → Environment Variables:
   - `DATABASE_URL` = that URI (mark Sensitive)
   - `DATABASE_POOL_MAX` = `1`
   - `DATABASE_CA_CERT` = text of the CA certificate (Supabase → Project Settings → Database → SSL Configuration → download)
   - the other variables listed in `docs/VERCEL_API_SPIKE.md`
3. Redeploy. Check `https://<api>/v1/health/ready` → `{"status":"ok"}`. That is the first real proof the connection works.
4. Only the API project gets database variables. The web and admin projects never get `DATABASE_URL` or any Supabase key.

## Later schema changes
Future migrations are applied with `prisma migrate deploy` using Supabase's **direct** connection string (Connect → Direct connection, port 5432), from your machine or CI, never from the Vercel build. Because `01-schema.sql` already marked migrations 0001–0006 as applied, that command only runs newer ones. After adding a migration, regenerate the SQL files with `node apps/api/scripts/build-supabase-sql.mjs`.
