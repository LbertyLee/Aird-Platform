-- 支付渠道密钥状态
CREATE TYPE "PaymentCredentialStatus" AS ENUM ('configured', 'missing', 'expired');

-- 支付渠道配置
CREATE TABLE "payment_channels" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "merchant_id" VARCHAR(128) NOT NULL,
    "callback_url" VARCHAR(512) NOT NULL,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "remark" VARCHAR(256),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_channels_pkey" PRIMARY KEY ("id")
);

-- 支付渠道密钥（密文）
CREATE TABLE "payment_channel_credentials" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PaymentCredentialStatus" NOT NULL DEFAULT 'configured',
    "last_rotated_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_channel_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_channels_code_key" ON "payment_channels"("code");
CREATE INDEX "payment_channels_status_sort_idx" ON "payment_channels"("status", "sort");
CREATE UNIQUE INDEX "payment_channel_credentials_channel_id_key" ON "payment_channel_credentials"("channel_id");

ALTER TABLE "payment_channel_credentials" ADD CONSTRAINT "payment_channel_credentials_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "payment_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
