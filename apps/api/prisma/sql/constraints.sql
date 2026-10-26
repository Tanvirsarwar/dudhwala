-- Constraints Prisma cannot express (docs/DATABASE_SCHEMA.md).
-- Appended to the initial migration; every statement is the last line of
-- defence behind application logic.

-- Identity
ALTER TABLE "user" ADD CONSTRAINT user_contact_present CHECK (phone IS NOT NULL OR email IS NOT NULL);
ALTER TABLE "user" ADD CONSTRAINT user_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+8801[3-9][0-9]{8}$');
ALTER TABLE "user" ADD CONSTRAINT user_staff_has_password CHECK (kind <> 'STAFF' OR password_hash IS NOT NULL);
ALTER TABLE outlet ADD CONSTRAINT outlet_code_format CHECK (code ~ '^[A-Z0-9-]+$');
ALTER TABLE outlet_hours ADD CONSTRAINT outlet_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE outlet_hours ADD CONSTRAINT outlet_hours_order CHECK (closes_at > opens_at);

-- Catalogue
ALTER TABLE product_variant ADD CONSTRAINT variant_price_positive CHECK (price_poisha > 0);
ALTER TABLE product_variant ADD CONSTRAINT variant_compare_at CHECK (compare_at_poisha IS NULL OR compare_at_poisha > price_poisha);
ALTER TABLE product_variant ADD CONSTRAINT variant_pack_size_positive CHECK (pack_size > 0);
-- Trigram search indexes on product names are declared in schema.prisma (GIN, gin_trgm_ops).

-- Inventory: no negative stock, no over-reservation
ALTER TABLE inventory ADD CONSTRAINT inventory_non_negative
  CHECK (quantity_on_hand >= 0 AND reserved_quantity >= 0 AND online_buffer_qty >= 0 AND low_stock_threshold >= 0);
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_le_on_hand CHECK (reserved_quantity <= quantity_on_hand);
ALTER TABLE stock_movement ADD CONSTRAINT movement_after_non_negative CHECK (on_hand_after >= 0 AND reserved_after >= 0);
ALTER TABLE stock_movement ADD CONSTRAINT movement_reason_required
  CHECK (type NOT IN ('ADJUST_UP','ADJUST_DOWN','WRITE_OFF','RECONCILE','RESTOCK_RETURN') OR (reason IS NOT NULL AND length(trim(reason)) > 0));
ALTER TABLE stock_movement ADD CONSTRAINT movement_actor_present CHECK (actor_user_id IS NOT NULL OR actor_system IS NOT NULL);
ALTER TABLE stock_transfer ADD CONSTRAINT transfer_distinct_outlets CHECK (from_outlet_id <> to_outlet_id);
ALTER TABLE stock_transfer_line ADD CONSTRAINT transfer_line_qty CHECK (qty > 0 AND (received_qty IS NULL OR received_qty >= 0));

-- Delivery
ALTER TABLE outlet_zone_rule ADD CONSTRAINT zone_rule_money
  CHECK (delivery_fee_poisha >= 0 AND min_order_poisha >= 0
         AND (free_delivery_min_poisha IS NULL OR free_delivery_min_poisha >= 0)
         AND (cod_max_order_poisha IS NULL OR cod_max_order_poisha > 0));
ALTER TABLE delivery_slot_template ADD CONSTRAINT slot_template_valid
  CHECK (weekday BETWEEN 0 AND 6 AND ends_at > starts_at AND capacity > 0 AND cutoff_minutes >= 0);
ALTER TABLE delivery_slot ADD CONSTRAINT slot_capacity
  CHECK (capacity > 0 AND booked_count >= 0 AND booked_count <= capacity);
ALTER TABLE delivery_slot ADD CONSTRAINT slot_times CHECK (ends_at > starts_at AND cutoff_at <= starts_at);
ALTER TABLE cod_collection ADD CONSTRAINT cod_amounts
  CHECK (expected_poisha >= 0 AND (collected_poisha IS NULL OR collected_poisha >= 0));
ALTER TABLE cod_collection ADD CONSTRAINT cod_separation_of_duties
  CHECK (received_by IS NULL OR collected_by IS NULL OR received_by <> collected_by);

-- Customers & carts
CREATE UNIQUE INDEX address_one_default ON address (user_id) WHERE is_default;
ALTER TABLE cart ADD CONSTRAINT cart_owner CHECK (user_id IS NOT NULL OR anonymous_token_hash IS NOT NULL);
ALTER TABLE cart_item ADD CONSTRAINT cart_item_qty CHECK (quantity BETWEEN 1 AND 99);

-- Orders: totals must be internally consistent
ALTER TABLE "order" ADD CONSTRAINT order_money
  CHECK (subtotal_poisha >= 0 AND discount_poisha >= 0 AND delivery_fee_poisha >= 0
         AND discount_poisha <= subtotal_poisha
         AND total_poisha = subtotal_poisha - discount_poisha + delivery_fee_poisha);
ALTER TABLE "order" ADD CONSTRAINT order_currency CHECK (currency = 'BDT');
ALTER TABLE "order" ADD CONSTRAINT order_online_has_expiry
  CHECK (payment_method <> 'ONLINE' OR status <> 'PENDING_PAYMENT' OR payment_expires_at IS NOT NULL);
CREATE INDEX order_pending_expiry ON "order" (payment_expires_at) WHERE status = 'PENDING_PAYMENT';
ALTER TABLE order_item ADD CONSTRAINT order_item_money
  CHECK (unit_price_poisha > 0 AND quantity > 0
         AND line_total_poisha = unit_price_poisha * quantity
         AND discount_allocated_poisha >= 0 AND discount_allocated_poisha <= line_total_poisha);

-- Payments
ALTER TABLE payment ADD CONSTRAINT payment_money
  CHECK (amount_poisha > 0 AND refunded_poisha >= 0
         AND (paid_amount_poisha IS NULL OR refunded_poisha <= paid_amount_poisha));
ALTER TABLE payment ADD CONSTRAINT payment_currency CHECK (currency = 'BDT');
ALTER TABLE payment ADD CONSTRAINT payment_paid_is_verified
  CHECK (status NOT IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') OR method = 'COD' OR verified_at IS NOT NULL);
CREATE INDEX payment_pending ON payment (created_at) WHERE status = 'PENDING';
ALTER TABLE refund ADD CONSTRAINT refund_amount CHECK (amount_poisha > 0);

-- Coupons
ALTER TABLE coupon ADD CONSTRAINT coupon_value
  CHECK ((type = 'PERCENT' AND value BETWEEN 1 AND 10000) OR (type = 'FIXED' AND value > 0) OR (type = 'FREE_DELIVERY'));
ALTER TABLE coupon ADD CONSTRAINT coupon_usage
  CHECK (used_count >= 0 AND (usage_limit_total IS NULL OR used_count <= usage_limit_total));
ALTER TABLE coupon_redemption ADD CONSTRAINT redemption_amount CHECK (discount_poisha >= 0);

-- Settings: one GLOBAL row per key (NULL outlet_id is not unique by default)
CREATE UNIQUE INDEX setting_global_key ON setting (key) WHERE outlet_id IS NULL;
ALTER TABLE setting ADD CONSTRAINT setting_scope_matches
  CHECK ((scope = 'GLOBAL' AND outlet_id IS NULL) OR (scope = 'OUTLET' AND outlet_id IS NOT NULL));

-- Append-only tables: block UPDATE/DELETE for everyone, including the app role.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER stock_movement_append_only BEFORE UPDATE OR DELETE ON stock_movement FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER order_status_event_append_only BEFORE UPDATE OR DELETE ON order_status_event FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Added in migration 0002
ALTER TABLE rate_limit_bucket ADD CONSTRAINT rate_limit_count_non_negative CHECK ("count" >= 0);

-- Added in migration 0004
CREATE UNIQUE INDEX privacy_request_one_open ON privacy_request (user_id) WHERE status = 'REQUESTED';
