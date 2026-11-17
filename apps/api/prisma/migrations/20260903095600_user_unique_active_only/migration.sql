-- Soft-deleted users must not occupy login identifiers.
-- Replace global unique indexes with partial unique indexes on active rows.

DROP INDEX IF EXISTS "users_username_key";
DROP INDEX IF EXISTS "users_email_key";
DROP INDEX IF EXISTS "users_phone_key";

CREATE UNIQUE INDEX "users_username_active_key"
  ON "users"("username")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "users_email_active_key"
  ON "users"("email")
  WHERE "deleted_at" IS NULL AND "email" IS NOT NULL;

CREATE UNIQUE INDEX "users_phone_active_key"
  ON "users"("phone")
  WHERE "deleted_at" IS NULL AND "phone" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users"("username");
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users"("email");
CREATE INDEX IF NOT EXISTS "users_phone_idx" ON "users"("phone");
