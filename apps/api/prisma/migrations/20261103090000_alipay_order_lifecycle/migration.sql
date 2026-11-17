ALTER TABLE "membership_orders"
 ADD COLUMN "duration_days" INTEGER,
 ADD COLUMN "entitlement_start_at" TIMESTAMP(3),
 ADD COLUMN "entitlement_end_at" TIMESTAMP(3),
 ADD COLUMN "refund_requested_at" TIMESTAMP(3);
UPDATE "membership_orders" o SET "duration_days" = p."duration_days"
FROM "membership_packages" p WHERE o."package_id" = p."id";
UPDATE "membership_orders" o SET "duration_days" = l."duration_days"
FROM "membership_levels" l WHERE o."level_id" = l."id" AND o."duration_days" IS NULL;

ALTER TABLE "membership_orders" ADD COLUMN "entitlement_chain_id" TEXT;
ALTER TABLE "user_subscriptions" ADD COLUMN "entitlement_chain_id" TEXT;
