-- Phase 2: replace the legacy delivery-slot / area / COD / rider / coupon domain with the compact V2 model.
--
-- DESTRUCTIVE for any database that already holds migrations 0001-0004 data: every table in the public schema
-- (except _prisma_migrations) and every enum type is dropped first. No production database exists yet; staging
-- and demo databases hold demo data only. Take a backup before applying anywhere else (docs/BACKUP_RESTORE.md).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
    EXECUTE 'DROP TABLE IF EXISTS public.' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE 'DROP TYPE IF EXISTS public.' || quote_ident(r.typname) || ' CASCADE';
  END LOOP;
END $$;

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "UserKind" AS ENUM ('CUSTOMER', 'STAFF');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'MANAGER');
CREATE TYPE "SessionKind" AS ENUM ('CUSTOMER', 'STAFF');
CREATE TYPE "OutletStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED');
CREATE TYPE "OuterCityStatus" AS ENUM ('APPROVED', 'DISABLED', 'PENDING_VERIFICATION', 'PENDING_CONFIRMATION');
CREATE TYPE "MovementType" AS ENUM ('SET', 'RESERVE', 'RELEASE', 'COMMIT_SALE');
CREATE TYPE "FulfilmentMethod" AS ENUM ('HOME_DELIVERY', 'EXPRESS_PICKUP', 'BULK_ORDER');
CREATE TYPE "DeliveryZone" AS ENUM ('IN_CITY', 'OUTER_CITY');
CREATE TYPE "OrderStatus" AS ENUM ('PLACED', 'PICKUP_REQUESTED', 'PENDING_PAYMENT', 'PREPAID', 'PREPARING', 'OUT_FOR_DELIVERY', 'READY_FOR_PICKUP', 'READY_FOR_COLLECTION', 'DELIVERED', 'PICKED_UP', 'COLLECTED', 'CANCELLED');
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED');
CREATE TYPE "PaymentRecordStatus" AS ENUM ('INITIATED', 'PAID', 'FAILED', 'CANCELLED');

CREATE TABLE "user" (
  "id" UUID NOT NULL,
  "phone" VARCHAR(14),
  "email" CITEXT,
  "full_name" VARCHAR(120),
  "password_hash" TEXT,
  "mfa_totp_secret_enc" BYTEA,
  "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  "mfa_last_step" INTEGER,
  "kind" "UserKind" NOT NULL,
  "staff_role" "StaffRole",
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "phone_verified_at" TIMESTAMPTZ,
  "last_login_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "session" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "kind" "SessionKind" NOT NULL,
  "ip" INET,
  "user_agent" VARCHAR(512),
  "mfa_verified" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "mfa_recovery_code" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "code_hash" TEXT NOT NULL,
  "used_at" TIMESTAMPTZ,
  CONSTRAINT "mfa_recovery_code_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "otp_challenge" (
  "id" UUID NOT NULL,
  "phone" VARCHAR(14) NOT NULL,
  "code_hash" CHAR(64) NOT NULL,
  "attempts" SMALLINT NOT NULL DEFAULT 0,
  "max_attempts" SMALLINT NOT NULL DEFAULT 5,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "ip" INET,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_challenge_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "outlet" (
  "id" UUID NOT NULL,
  "code" VARCHAR(32) NOT NULL,
  "name_bn" TEXT NOT NULL,
  "name_en" TEXT,
  "address_line" TEXT NOT NULL,
  "phone" VARCHAR(20),
  "status" "OutletStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "outlet_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "outlet_hours" (
  "outlet_id" UUID NOT NULL,
  "weekday" SMALLINT NOT NULL,
  "opens_at" TIME(0) NOT NULL,
  "closes_at" TIME(0) NOT NULL,
  CONSTRAINT "outlet_hours_pkey" PRIMARY KEY ("outlet_id", "weekday")
);
CREATE TABLE "category" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "name_bn" TEXT NOT NULL,
  "name_en" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "product" (
  "id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "name_bn" TEXT NOT NULL,
  "name_en" TEXT,
  "name_verified" BOOLEAN NOT NULL DEFAULT false,
  "outer_city_status" "OuterCityStatus",
  "active" BOOLEAN NOT NULL DEFAULT false,
  "description_bn" TEXT,
  "ingredients_bn" TEXT,
  "allergens_bn" TEXT,
  "storage_bn" TEXT,
  "shelf_life_bn" TEXT,
  "image_key" TEXT,
  "image_width" INTEGER,
  "image_height" INTEGER,
  "image_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "product_variant" (
  "id" UUID NOT NULL,
  "product_id" UUID NOT NULL,
  "label_bn" TEXT NOT NULL DEFAULT '',
  "label_en" TEXT,
  "price_poisha" INTEGER,
  "compare_at_poisha" INTEGER,
  "max_qty" INTEGER NOT NULL DEFAULT 20,
  "track_stock" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "inventory" (
  "id" UUID NOT NULL,
  "outlet_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
  "reserved_quantity" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "stock_movement" (
  "id" UUID NOT NULL,
  "inventory_id" UUID NOT NULL,
  "outlet_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "type" "MovementType" NOT NULL,
  "qty_delta_on_hand" INTEGER NOT NULL,
  "qty_delta_reserved" INTEGER NOT NULL,
  "on_hand_after" INTEGER NOT NULL,
  "reserved_after" INTEGER NOT NULL,
  "reason" TEXT,
  "order_id" UUID,
  "actor_user_id" UUID,
  "actor_system" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "cart" (
  "id" UUID NOT NULL,
  "user_id" UUID,
  "anonymous_token_hash" CHAR(64),
  "updated_at" TIMESTAMPTZ NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "cart_item" (
  "cart_id" UUID NOT NULL,
  "product_variant_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  CONSTRAINT "cart_item_pkey" PRIMARY KEY ("cart_id", "product_variant_id")
);
CREATE TABLE "order" (
  "id" UUID NOT NULL,
  "order_number" VARCHAR(16) NOT NULL,
  "user_id" UUID NOT NULL,
  "outlet_id" UUID NOT NULL,
  "method" "FulfilmentMethod" NOT NULL,
  "zone" "DeliveryZone",
  "status" "OrderStatus" NOT NULL,
  "payment_status" "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  "contact_name" VARCHAR(80) NOT NULL,
  "contact_phone" VARCHAR(14) NOT NULL,
  "address_line1" VARCHAR(300),
  "address_landmark" VARCHAR(120),
  "pickup_at" TIMESTAMPTZ,
  "subtotal_poisha" INTEGER NOT NULL,
  "delivery_fee_poisha" INTEGER NOT NULL DEFAULT 0,
  "total_poisha" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
  "idempotency_key" VARCHAR(64) NOT NULL,
  "bulk_rule_snapshot" JSONB,
  "payment_expires_at" TIMESTAMPTZ,
  "cancel_reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "order_item" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "product_variant_id" UUID,
  "product_slug" VARCHAR(120) NOT NULL,
  "product_name_bn" TEXT NOT NULL,
  "product_name_en" TEXT,
  "variant_label_bn" TEXT NOT NULL,
  "unit_price_poisha" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "line_total_poisha" INTEGER NOT NULL,
  CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "order_status_event" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "from_status" "OrderStatus",
  "to_status" "OrderStatus" NOT NULL,
  "actor_user_id" UUID,
  "actor_role" VARCHAR(32) NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_status_event_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "payment" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "status" "PaymentRecordStatus" NOT NULL DEFAULT 'INITIATED',
  "amount_poisha" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
  "merchant_tran_id" VARCHAR(64) NOT NULL,
  "provider_tran_id" VARCHAR(128),
  "verified_at" TIMESTAMPTZ,
  "paid_amount_poisha" INTEGER,
  "failure_code" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "payment_event" (
  "id" UUID NOT NULL,
  "payment_id" UUID,
  "provider" VARCHAR(32) NOT NULL,
  "provider_event_id" VARCHAR(128) NOT NULL,
  "signature_valid" BOOLEAN NOT NULL,
  "payload" JSONB NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processing_result" TEXT,
  CONSTRAINT "payment_event_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "audit_log" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "actor_role" VARCHAR(32) NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "entity_type" VARCHAR(48) NOT NULL,
  "entity_id" VARCHAR(64),
  "before" JSONB,
  "after" JSONB,
  "ip" INET,
  "user_agent" VARCHAR(512),
  "request_id" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "setting" (
  "key" VARCHAR(96) NOT NULL,
  "value" JSONB NOT NULL,
  "updated_by" UUID,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "setting_pkey" PRIMARY KEY ("key")
);
CREATE TABLE "idempotency_record" (
  "key" VARCHAR(64) NOT NULL,
  "principal" VARCHAR(80) NOT NULL,
  "route" VARCHAR(120) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "response_body" JSONB,
  "status_code" SMALLINT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("key", "principal", "route")
);
CREATE TABLE "rate_limit_bucket" (
  "key" VARCHAR(160) NOT NULL,
  "window_start" TIMESTAMPTZ NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key", "window_start")
);

CREATE UNIQUE INDEX "user_phone_key" ON "user" ("phone");
CREATE UNIQUE INDEX "user_email_key" ON "user" ("email");
CREATE UNIQUE INDEX "session_token_hash_key" ON "session" ("token_hash");
CREATE INDEX "session_user_id_idx" ON "session" ("user_id");
CREATE INDEX "session_expires_at_idx" ON "session" ("expires_at");
CREATE INDEX "mfa_recovery_code_user_id_idx" ON "mfa_recovery_code" ("user_id");
CREATE INDEX "otp_challenge_phone_created_at_idx" ON "otp_challenge" ("phone", "created_at");
CREATE INDEX "otp_challenge_ip_created_at_idx" ON "otp_challenge" ("ip", "created_at");
CREATE UNIQUE INDEX "outlet_code_key" ON "outlet" ("code");
CREATE UNIQUE INDEX "category_slug_key" ON "category" ("slug");
CREATE UNIQUE INDEX "product_slug_key" ON "product" ("slug");
CREATE INDEX "product_category_id_active_idx" ON "product" ("category_id", "active");
CREATE INDEX "product_variant_product_id_idx" ON "product_variant" ("product_id");
CREATE UNIQUE INDEX "inventory_outlet_id_product_variant_id_key" ON "inventory" ("outlet_id", "product_variant_id");
CREATE INDEX "stock_movement_outlet_id_created_at_idx" ON "stock_movement" ("outlet_id", "created_at" DESC);
CREATE INDEX "stock_movement_inventory_id_created_at_idx" ON "stock_movement" ("inventory_id", "created_at");
CREATE INDEX "stock_movement_order_id_idx" ON "stock_movement" ("order_id");
CREATE UNIQUE INDEX "cart_user_id_key" ON "cart" ("user_id");
CREATE UNIQUE INDEX "cart_anonymous_token_hash_key" ON "cart" ("anonymous_token_hash");
CREATE INDEX "cart_expires_at_idx" ON "cart" ("expires_at");
CREATE UNIQUE INDEX "order_order_number_key" ON "order" ("order_number");
CREATE INDEX "order_outlet_id_status_created_at_idx" ON "order" ("outlet_id", "status", "created_at" DESC);
CREATE INDEX "order_user_id_created_at_idx" ON "order" ("user_id", "created_at" DESC);
CREATE INDEX "order_status_created_at_idx" ON "order" ("status", "created_at" DESC);
CREATE UNIQUE INDEX "order_user_id_idempotency_key_key" ON "order" ("user_id", "idempotency_key");
CREATE INDEX "order_item_order_id_idx" ON "order_item" ("order_id");
CREATE INDEX "order_status_event_order_id_created_at_idx" ON "order_status_event" ("order_id", "created_at");
CREATE UNIQUE INDEX "payment_merchant_tran_id_key" ON "payment" ("merchant_tran_id");
CREATE INDEX "payment_order_id_idx" ON "payment" ("order_id");
CREATE UNIQUE INDEX "payment_provider_provider_tran_id_key" ON "payment" ("provider", "provider_tran_id");
CREATE INDEX "payment_event_payment_id_idx" ON "payment_event" ("payment_id");
CREATE UNIQUE INDEX "payment_event_provider_provider_event_id_key" ON "payment_event" ("provider", "provider_event_id");
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log" ("entity_type", "entity_id");
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log" ("actor_user_id", "created_at" DESC);
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" ("created_at" DESC);
CREATE INDEX "idempotency_record_created_at_idx" ON "idempotency_record" ("created_at");
CREATE INDEX "rate_limit_bucket_window_start_idx" ON "rate_limit_bucket" ("window_start");

ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_recovery_code" ADD CONSTRAINT "mfa_recovery_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outlet_hours" ADD CONSTRAINT "outlet_hours_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cart" ADD CONSTRAINT "cart_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order" ADD CONSTRAINT "order_outlet_id_fkey" FOREIGN KEY ("outlet_id") REFERENCES "outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "order_status_event" ADD CONSTRAINT "order_status_event_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_event" ADD CONSTRAINT "payment_event_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Constraints Prisma cannot express. Appended to migration 0005_v2_domain and
-- applied by the dev bootstrap; every statement is the last line of defence
-- behind application logic.

-- Identity
ALTER TABLE "user" ADD CONSTRAINT user_contact_present CHECK (phone IS NOT NULL OR email IS NOT NULL);
ALTER TABLE "user" ADD CONSTRAINT user_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$');
ALTER TABLE "user" ADD CONSTRAINT user_staff_has_password CHECK (kind <> 'STAFF' OR password_hash IS NOT NULL);
ALTER TABLE "user" ADD CONSTRAINT user_staff_has_role CHECK ((kind = 'STAFF') = (staff_role IS NOT NULL));
ALTER TABLE outlet ADD CONSTRAINT outlet_code_format CHECK (code ~ '^[A-Z0-9-]+$');
ALTER TABLE outlet_hours ADD CONSTRAINT outlet_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE outlet_hours ADD CONSTRAINT outlet_hours_order CHECK (closes_at > opens_at);

-- Catalogue: prices are positive whole poisha or NULL (not set yet)
ALTER TABLE product_variant ADD CONSTRAINT variant_price_positive CHECK (price_poisha IS NULL OR price_poisha > 0);
ALTER TABLE product_variant ADD CONSTRAINT variant_compare_at CHECK (compare_at_poisha IS NULL OR (price_poisha IS NOT NULL AND compare_at_poisha > price_poisha));
ALTER TABLE product_variant ADD CONSTRAINT variant_max_qty CHECK (max_qty BETWEEN 1 AND 999);

-- Inventory: no negative stock, no over-reservation
ALTER TABLE inventory ADD CONSTRAINT inventory_non_negative CHECK (quantity_on_hand >= 0 AND reserved_quantity >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_le_on_hand CHECK (reserved_quantity <= quantity_on_hand);
ALTER TABLE stock_movement ADD CONSTRAINT movement_after_non_negative CHECK (on_hand_after >= 0 AND reserved_after >= 0);
ALTER TABLE stock_movement ADD CONSTRAINT movement_actor_present CHECK (actor_user_id IS NOT NULL OR actor_system IS NOT NULL);

-- Cart
ALTER TABLE cart ADD CONSTRAINT cart_owner CHECK (user_id IS NOT NULL OR anonymous_token_hash IS NOT NULL);
ALTER TABLE cart_item ADD CONSTRAINT cart_item_qty CHECK (quantity BETWEEN 1 AND 999);

-- Orders: totals consistent, method/zone/contact rules, status valid for the method
ALTER TABLE "order" ADD CONSTRAINT order_money
  CHECK (subtotal_poisha > 0 AND delivery_fee_poisha >= 0 AND total_poisha = subtotal_poisha + delivery_fee_poisha);
ALTER TABLE "order" ADD CONSTRAINT order_currency CHECK (currency = 'BDT');
ALTER TABLE "order" ADD CONSTRAINT order_method_fields CHECK (
  (method = 'HOME_DELIVERY' AND zone IS NOT NULL AND address_line1 IS NOT NULL AND pickup_at IS NULL) OR
  (method = 'EXPRESS_PICKUP' AND zone IS NULL AND address_line1 IS NULL AND pickup_at IS NOT NULL) OR
  (method = 'BULK_ORDER' AND zone IS NULL AND address_line1 IS NULL AND pickup_at IS NULL));
ALTER TABLE "order" ADD CONSTRAINT order_status_matches_method CHECK (status = 'CANCELLED' OR
  (method = 'HOME_DELIVERY' AND status IN ('PLACED','PREPARING','OUT_FOR_DELIVERY','DELIVERED')) OR
  (method = 'EXPRESS_PICKUP' AND status IN ('PICKUP_REQUESTED','PREPARING','READY_FOR_PICKUP','PICKED_UP')) OR
  (method = 'BULK_ORDER' AND status IN ('PENDING_PAYMENT','PREPAID','PREPARING','READY_FOR_COLLECTION','COLLECTED')));
-- A bulk order past PENDING_PAYMENT must have a verified payment on record.
ALTER TABLE "order" ADD CONSTRAINT order_bulk_paid CHECK (
  method <> 'BULK_ORDER' OR status IN ('PENDING_PAYMENT','CANCELLED') OR payment_status = 'PAID');
CREATE INDEX order_pending_expiry ON "order" (payment_expires_at) WHERE status = 'PENDING_PAYMENT';
ALTER TABLE order_item ADD CONSTRAINT order_item_money
  CHECK (unit_price_poisha > 0 AND quantity > 0 AND line_total_poisha = unit_price_poisha * quantity);

-- Payments
ALTER TABLE payment ADD CONSTRAINT payment_money CHECK (amount_poisha > 0 AND (paid_amount_poisha IS NULL OR paid_amount_poisha > 0));
ALTER TABLE payment ADD CONSTRAINT payment_currency CHECK (currency = 'BDT');
ALTER TABLE payment ADD CONSTRAINT payment_paid_is_verified CHECK (status <> 'PAID' OR (verified_at IS NOT NULL AND paid_amount_poisha = amount_poisha));

-- Rate limits
ALTER TABLE rate_limit_bucket ADD CONSTRAINT rate_limit_count_non_negative CHECK ("count" >= 0);

-- Append-only tables: block UPDATE/DELETE for everyone, including the app role.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON stock_movement FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER order_status_event_append_only BEFORE UPDATE OR DELETE ON order_status_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER payment_event_append_only BEFORE DELETE ON payment_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
