-- Customer account-deletion requests (OPEN_DECISIONS F6)
CREATE TYPE "PrivacyRequestKind" AS ENUM ('DELETE');
CREATE TYPE "PrivacyRequestStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'REJECTED');

CREATE TABLE "privacy_request" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "PrivacyRequestKind" NOT NULL,
    "status" "PrivacyRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "note" VARCHAR(500),
    "processed_by" UUID,
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "privacy_request_status_created_at_idx" ON "privacy_request"("status", "created_at");
CREATE INDEX "privacy_request_user_id_idx" ON "privacy_request"("user_id");

ALTER TABLE "privacy_request" ADD CONSTRAINT "privacy_request_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one open request per customer.
CREATE UNIQUE INDEX privacy_request_one_open ON privacy_request (user_id) WHERE status = 'REQUESTED';
