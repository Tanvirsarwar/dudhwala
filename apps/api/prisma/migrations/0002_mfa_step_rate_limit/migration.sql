-- DB-backed TOTP replay guard (SECURITY_REVIEW finding 2026-10-19)
ALTER TABLE "user" ADD COLUMN "mfa_last_step" INTEGER;

-- Shared fixed-window rate-limit counters (SECURITY_REVIEW finding 2026-10-19)
CREATE TABLE "rate_limit_bucket" (
    "key" VARCHAR(160) NOT NULL,
    "window_start" TIMESTAMPTZ NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_bucket_pkey" PRIMARY KEY ("key","window_start")
);

CREATE INDEX "rate_limit_bucket_window_start_idx" ON "rate_limit_bucket"("window_start");

ALTER TABLE "rate_limit_bucket" ADD CONSTRAINT rate_limit_count_non_negative CHECK ("count" >= 0);
