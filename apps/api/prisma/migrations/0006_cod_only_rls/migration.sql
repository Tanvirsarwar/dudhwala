-- Cash on delivery only: remove the online-payment tables and statuses, store payment method/status per order,
-- and lock the tables against Supabase's public Data API (RLS on, no policies, anon/authenticated revoked).

-- 1. Online payment tables are gone.
DROP TABLE IF EXISTS "payment_event";
DROP TABLE IF EXISTS "payment";
DROP TYPE IF EXISTS "PaymentRecordStatus";

-- 2. Constraints and indexes that mention the old statuses.
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_status_matches_method;
ALTER TABLE "order" DROP CONSTRAINT IF EXISTS order_bulk_paid;
DROP INDEX IF EXISTS order_pending_expiry;

-- 3. OrderStatus loses PENDING_PAYMENT and PREPAID. (Rows in those states never carried money: PENDING_PAYMENT -> CANCELLED, PREPAID -> PLACED.)
ALTER TABLE "order" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "order_status_event" ALTER COLUMN "from_status" TYPE TEXT USING "from_status"::TEXT;
ALTER TABLE "order_status_event" ALTER COLUMN "to_status" TYPE TEXT USING "to_status"::TEXT;
-- the append-only trigger on order_status_event forbids UPDATE, so history rows keep their old text; map them for the cast below
ALTER TABLE "order_status_event" DISABLE TRIGGER order_status_event_append_only;
UPDATE "order" SET status = CASE status WHEN 'PENDING_PAYMENT' THEN 'CANCELLED' WHEN 'PREPAID' THEN 'PLACED' ELSE status END;
UPDATE "order_status_event" SET from_status = CASE from_status WHEN 'PENDING_PAYMENT' THEN 'PLACED' WHEN 'PREPAID' THEN 'PLACED' ELSE from_status END,
                                to_status = CASE to_status WHEN 'PENDING_PAYMENT' THEN 'PLACED' WHEN 'PREPAID' THEN 'PLACED' ELSE to_status END;
ALTER TABLE "order_status_event" ENABLE TRIGGER order_status_event_append_only;
DROP TYPE "OrderStatus";
CREATE TYPE "OrderStatus" AS ENUM ('PLACED','PICKUP_REQUESTED','PREPARING','OUT_FOR_DELIVERY','READY_FOR_PICKUP','READY_FOR_COLLECTION','DELIVERED','PICKED_UP','COLLECTED','CANCELLED');
ALTER TABLE "order" ALTER COLUMN "status" TYPE "OrderStatus" USING "status"::"OrderStatus";
ALTER TABLE "order_status_event" ALTER COLUMN "from_status" TYPE "OrderStatus" USING "from_status"::"OrderStatus";
ALTER TABLE "order_status_event" ALTER COLUMN "to_status" TYPE "OrderStatus" USING "to_status"::"OrderStatus";

-- 4. Payment method + status on the order.
ALTER TABLE "order" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TABLE "order" ALTER COLUMN "payment_status" TYPE TEXT USING "payment_status"::TEXT;
UPDATE "order" SET payment_status = CASE WHEN payment_status = 'PAID' THEN 'PAID' ELSE 'UNPAID' END;
DROP TYPE "PaymentStatus";
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');
CREATE TYPE "PaymentMethod" AS ENUM ('COD');
ALTER TABLE "order" ALTER COLUMN "payment_status" TYPE "PaymentStatus" USING "payment_status"::"PaymentStatus";
ALTER TABLE "order" ALTER COLUMN "payment_status" SET DEFAULT 'UNPAID';
ALTER TABLE "order" ADD COLUMN "payment_method" "PaymentMethod" NOT NULL DEFAULT 'COD';
ALTER TABLE "order" ADD COLUMN "paid_at" TIMESTAMPTZ;
ALTER TABLE "order" ADD COLUMN "paid_by" UUID;
ALTER TABLE "order" DROP COLUMN "payment_expires_at";
-- orders already marked PAID (verified online payments in the old design) keep that, dated at their last update
UPDATE "order" SET paid_at = updated_at WHERE payment_status = 'PAID';

-- 5. Rules, re-stated for the new statuses.
ALTER TABLE "order" ADD CONSTRAINT order_status_matches_method CHECK (status = 'CANCELLED' OR
  (method = 'HOME_DELIVERY' AND status IN ('PLACED','PREPARING','OUT_FOR_DELIVERY','DELIVERED')) OR
  (method = 'EXPRESS_PICKUP' AND status IN ('PICKUP_REQUESTED','PREPARING','READY_FOR_PICKUP','PICKED_UP')) OR
  (method = 'BULK_ORDER' AND status IN ('PLACED','PREPARING','READY_FOR_COLLECTION','COLLECTED')));
ALTER TABLE "order" ADD CONSTRAINT order_paid_has_time CHECK ((payment_status = 'PAID') = (paid_at IS NOT NULL));
CREATE INDEX "order_payment_status_idx" ON "order" ("payment_status", "created_at" DESC);

-- 6. Supabase: the browser must never reach these tables through the Data API (PostgREST). Row Level Security is enabled on
--    every table with NO policies, so anon and authenticated see nothing; only the API's server-side database connection
--    (the table owner / a role with BYPASSRLS) reads and writes. Tables created later must repeat this (see docs/SUPABASE_VERCEL.md).
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
