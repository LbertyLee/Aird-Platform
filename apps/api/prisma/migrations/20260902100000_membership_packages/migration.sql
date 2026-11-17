-- CreateEnum
CREATE TYPE "PackageType" AS ENUM ('monthly', 'auto_renew_monthly', 'yearly');

-- CreateEnum
CREATE TYPE "PackageTag" AS ENUM ('on_sale', 'recommended', 'off_shelf');

-- AlterTable
ALTER TABLE "membership_levels" ADD COLUMN "is_purchasable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "membership_packages" (
    "id" TEXT NOT NULL,
    "level_id" TEXT NOT NULL,
    "package_type" "PackageType" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "original_price" DECIMAL(12,2),
    "price_label" VARCHAR(64),
    "description" VARCHAR(512),
    "tag" "PackageTag" NOT NULL DEFAULT 'on_sale',
    "duration_days" INTEGER NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "membership_packages_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "user_subscriptions" ADD COLUMN "package_id" TEXT;

-- AlterTable
ALTER TABLE "membership_orders" ADD COLUMN "package_id" TEXT,
ADD COLUMN "title" VARCHAR(128),
ADD COLUMN "payment_channel" VARCHAR(32),
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "refunded_at" TIMESTAMP(3),
ADD COLUMN "refund_reason" VARCHAR(256);

-- CreateTable
CREATE TABLE "refund_records" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(256),
    "trade_no" VARCHAR(128),
    "refunded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_packages_level_id_package_type_key" ON "membership_packages"("level_id", "package_type");

-- AddForeignKey
ALTER TABLE "membership_packages" ADD CONSTRAINT "membership_packages_level_id_fkey" FOREIGN KEY ("level_id") REFERENCES "membership_levels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "membership_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_orders" ADD CONSTRAINT "membership_orders_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "membership_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "membership_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
