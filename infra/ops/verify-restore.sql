-- Run against a RESTORED copy of the database (never production) after a restore test
-- (DEPLOYMENT_RUNBOOK §8):  psql "$RESTORED_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/ops/verify-restore.sql
-- Every query must return zero rows / true. Record the output in the runbook log.

\echo '1. Migrations applied (expect the latest migration name)'
SELECT to_regclass('_prisma_migrations') IS NOT NULL AS has_migrations \gset
\if :has_migrations
SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;
\else
\echo '   (no _prisma_migrations table: schema was applied outside prisma migrate)'
\endif

\echo '2. Row counts (compare with production at backup time)'
SELECT 'orders' AS t, count(*) FROM "order" UNION ALL
SELECT 'order_items', count(*) FROM order_item UNION ALL
SELECT 'payments', count(*) FROM payment UNION ALL
SELECT 'stock_movements', count(*) FROM stock_movement UNION ALL
SELECT 'users', count(*) FROM "user" UNION ALL
SELECT 'audit_log', count(*) FROM audit_log;

\echo '3. Newest order and payment (should be close to the backup time)'
SELECT max(created_at) AS newest_order FROM "order";
SELECT max(updated_at) AS newest_payment_change FROM payment;

\echo '4. Integrity: order totals add up (expect 0)'
SELECT count(*) AS bad_totals FROM "order" WHERE total_poisha <> subtotal_poisha - discount_poisha + delivery_fee_poisha;

\echo '5. Integrity: item lines add up to subtotal (expect 0)'
SELECT count(*) AS bad_subtotals FROM "order" o
WHERE o.subtotal_poisha <> (SELECT COALESCE(sum(line_total_poisha), 0) FROM order_item i WHERE i.order_id = o.id);

\echo '6. Integrity: stock never negative or over-reserved (expect 0)'
SELECT count(*) AS bad_stock FROM inventory WHERE quantity_on_hand < 0 OR reserved_quantity < 0 OR reserved_quantity > quantity_on_hand;

\echo '7. Integrity: on-hand matches the movement ledger where history is complete (expect 0)'
SELECT count(*) AS ledger_mismatch FROM inventory inv
JOIN LATERAL (SELECT on_hand_after FROM stock_movement m WHERE m.inventory_id = inv.id ORDER BY created_at DESC, id DESC LIMIT 1) last ON true
WHERE last.on_hand_after <> inv.quantity_on_hand;

\echo '8. Integrity: slot bookings within capacity (expect 0)'
SELECT count(*) AS overbooked FROM delivery_slot WHERE booked_count > capacity OR booked_count < 0;

\echo '9. Paid online payments are verified (expect 0)'
SELECT count(*) AS unverified_paid FROM payment WHERE method = 'ONLINE' AND status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND verified_at IS NULL;

\echo '10. Append-only triggers present (expect 3)'
SELECT count(*) FROM pg_trigger WHERE tgname IN ('stock_movement_append_only','audit_log_append_only','order_status_event_append_only');
