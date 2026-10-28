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
