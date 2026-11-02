-- Dudhwala: the owner's real outlets and the two outlet roles. TEMPLATE: replace every REPLACE_ME with real data before running.
-- Nothing here is invented; with no outlet, home delivery, pickup and showroom orders stay unavailable.
-- Run AFTER 01-schema.sql. Needs a real address for each outlet (the column is required).
BEGIN;

-- Outlet 1: Modina Market Branch (the showroom / collection point). Code: capital letters, digits, hyphen.
INSERT INTO outlet (id, code, name_bn, name_en, address_line, phone, status, updated_at)
VALUES (gen_random_uuid(), 'MODINA-MARKET', 'মদিনা মার্কেট শাখা', 'Modina Market Branch', 'REPLACE_ME address', 'REPLACE_ME phone', 'ACTIVE', now())
ON CONFLICT (code) DO NOTHING;

-- Opening hours (weekday 0 = Sunday ... 6 = Saturday, Dhaka time). One row per open day; REPLACE_ME with the real hours, or delete this block
-- (an outlet with no hours uses the ordering hours).
INSERT INTO outlet_hours (outlet_id, weekday, opens_at, closes_at)
SELECT o.id, d, TIME 'REPLACE_ME opening e.g. 10:00', TIME 'REPLACE_ME closing e.g. 22:00'
FROM outlet o, generate_series(0, 6) AS d
WHERE o.code = 'MODINA-MARKET'
ON CONFLICT DO NOTHING;

-- Which outlet supplies home delivery, and which one takes showroom orders.
INSERT INTO setting (key, value, updated_at)
SELECT 'fulfilment.dispatchOutletId', to_jsonb(id::text), now() FROM outlet WHERE code = 'MODINA-MARKET'
ON CONFLICT (key) DO NOTHING;
INSERT INTO setting (key, value, updated_at)
SELECT 'bulk.collectionOutletId', to_jsonb(id::text), now() FROM outlet WHERE code = 'MODINA-MARKET'
ON CONFLICT (key) DO NOTHING;

-- Home-delivery fee per zone in POISHA (100 poisha = Tk 1). 0 = free. In Sylhet = IN_CITY, Outer Sylhet = OUTER_CITY.
INSERT INTO setting (key, value, updated_at)
VALUES ('delivery.fees', '{"IN_CITY": 0, "OUTER_CITY": 0}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

COMMIT;
