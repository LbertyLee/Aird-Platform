CREATE TABLE "point_accounts" (
    "user_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "point_accounts_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "point_ledgers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "reference" VARCHAR(128) NOT NULL,
    "description" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "point_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "point_ledgers_user_id_reference_key" ON "point_ledgers"("user_id", "reference");
CREATE INDEX "point_ledgers_user_id_created_at_idx" ON "point_ledgers"("user_id", "created_at");
ALTER TABLE "point_accounts" ADD CONSTRAINT "point_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "point_ledgers" ADD CONSTRAINT "point_ledgers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
