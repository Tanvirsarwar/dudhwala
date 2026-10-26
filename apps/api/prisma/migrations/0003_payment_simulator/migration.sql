-- Payment gateway simulator ledger (PAYMENTS_PROVIDER=fake; never used in production)
CREATE TYPE "FakeGatewayStatus" AS ENUM ('INITIATED', 'SUCCESS', 'FAILED', 'CANCELLED');

CREATE TABLE "fake_gateway_txn" (
    "session_id" VARCHAR(64) NOT NULL,
    "merchant_tran_id" VARCHAR(64) NOT NULL,
    "provider_tran_id" VARCHAR(64) NOT NULL,
    "amount_poisha" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BDT',
    "status" "FakeGatewayStatus" NOT NULL DEFAULT 'INITIATED',
    "refunded_poisha" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "fake_gateway_txn_pkey" PRIMARY KEY ("session_id")
);

CREATE UNIQUE INDEX "fake_gateway_txn_merchant_tran_id_key" ON "fake_gateway_txn"("merchant_tran_id");
CREATE UNIQUE INDEX "fake_gateway_txn_provider_tran_id_key" ON "fake_gateway_txn"("provider_tran_id");
