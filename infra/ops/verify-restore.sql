-- Run against a RESTORED copy of the database (never production) after a restore test
-- (docs/DEPLOY_PHASE2.md, backup and restore):  psql "$RESTORED_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/ops/verify-restore.sql
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
SELECT count(*) AS bad_totals FROM "order" WHERE total_poisha <> subtotal_poisha + delivery_fee_poisha;

\echo '5. Integrity: item lines add up to subtotal (expect 0)'
SELECT count(*) AS bad_subtotals FROM "order" o
WHERE o.subtotal_poisha <> (SELECT COALESCE(sum(line_total_poisha), 0) FROM order_item i WHERE i.order_id = o.id);

\echo '6. Integrity: stock never negative or over-reserved (expect 0)'
SELECT count(*) AS bad_stock FROM inventory WHERE quantity_on_hand < 0 OR reserved_quantity < 0 OR reserved_quantity > quantity_on_hand;

\echo '7. Integrity: on-hand matches the movement ledger where history is complete (expect 0)'
SELECT count(*) AS ledger_mismatch FROM inventory inv
JOIN LATERAL (SELECT on_hand_after FROM stock_movement m WHERE m.inventory_id = inv.id ORDER BY created_at DESC, id DESC LIMIT 1) last ON true
WHERE last.on_hand_after <> inv.quantity_on_hand;

\echo '8. Integrity: bulk orders past PENDING_PAYMENT have a verified payment (expect 0)'
SELECT count(*) AS bulk_without_payment FROM "order" o
WHERE o.method = 'BULK_ORDER' AND o.status NOT IN ('PENDING_PAYMENT','CANCELLED')
  AND NOT EXISTS (SELECT 1 FROM payment p WHERE p.order_id = o.id AND p.status = 'PAID' AND p.verified_at IS NOT NULL);

\echo '9. Integrity: every paid payment is verified and equals the order total (expect 0)'
SELECT count(*) AS bad_paid FROM payment p JOIN "order" o ON o.id = p.order_id
WHERE p.status = 'PAID' AND (p.verified_at IS NULL OR p.paid_amount_poisha <> p.amount_poisha OR p.amount_poisha <> o.total_poisha);

\echo '10. Append-only triggers present (expect 4)'
SELECT count(*) FROM pg_trigger WHERE tgname IN ('stock_movement_append_only','audit_log_append_only','order_status_event_append_only','payment_event_append_only');

\echo '11. Settings present (dispatch and collection outlet ids)'
SELECT key FROM setting WHERE key IN ('fulfilment.dispatchOutletId','bulk.collectionOutletId') ORDER BY key;
