-- Dataset: drop org visibility; restore indicator/dictionary links

ALTER TABLE "datasets" DROP CONSTRAINT IF EXISTS "datasets_org_id_fkey";
DROP INDEX IF EXISTS "datasets_org_id_idx";
ALTER TABLE "datasets" DROP COLUMN IF EXISTS "org_id";

ALTER TYPE "DatasetVisibility" RENAME TO "DatasetVisibility_old";
CREATE TYPE "DatasetVisibility" AS ENUM ('public', 'private');
ALTER TABLE "datasets" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "datasets" ALTER COLUMN "visibility" TYPE "DatasetVisibility" USING (
  CASE WHEN "visibility"::text = 'public' THEN 'public'::"DatasetVisibility" ELSE 'private'::"DatasetVisibility" END
);
ALTER TABLE "datasets" ALTER COLUMN "visibility" SET DEFAULT 'private'::"DatasetVisibility";
DROP TYPE "DatasetVisibility_old";

DO $$ BEGIN
  CREATE TYPE "DatasetLinkSource" AS ENUM ('auto', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DatasetLinkTargetType" AS ENUM ('indicator', 'dictionary');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "dataset_indicators" (
    "dataset_id" TEXT NOT NULL,
    "indicator_id" TEXT NOT NULL,
    "source" "DatasetLinkSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_indicators_pkey" PRIMARY KEY ("dataset_id","indicator_id")
);

CREATE TABLE IF NOT EXISTS "dataset_dictionary_items" (
    "dataset_id" TEXT NOT NULL,
    "dictionary_item_id" TEXT NOT NULL,
    "source" "DatasetLinkSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_dictionary_items_pkey" PRIMARY KEY ("dataset_id","dictionary_item_id")
);

CREATE TABLE IF NOT EXISTS "dataset_link_dismissals" (
    "dataset_id" TEXT NOT NULL,
    "target_type" "DatasetLinkTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_link_dismissals_pkey" PRIMARY KEY ("dataset_id","target_type","target_id")
);

DO $$ BEGIN
  ALTER TABLE "dataset_indicators" ADD COLUMN "source" "DatasetLinkSource" NOT NULL DEFAULT 'manual';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_dictionary_items" ADD COLUMN "source" "DatasetLinkSource" NOT NULL DEFAULT 'manual';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "dataset_indicators_indicator_id_idx" ON "dataset_indicators"("indicator_id");
CREATE INDEX IF NOT EXISTS "dataset_indicators_source_idx" ON "dataset_indicators"("source");
CREATE INDEX IF NOT EXISTS "dataset_dictionary_items_dictionary_item_id_idx" ON "dataset_dictionary_items"("dictionary_item_id");
CREATE INDEX IF NOT EXISTS "dataset_dictionary_items_source_idx" ON "dataset_dictionary_items"("source");
CREATE INDEX IF NOT EXISTS "dataset_link_dismissals_dataset_id_idx" ON "dataset_link_dismissals"("dataset_id");

DO $$ BEGIN
  ALTER TABLE "dataset_indicators" ADD CONSTRAINT "dataset_indicators_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_indicators" ADD CONSTRAINT "dataset_indicators_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_dictionary_items" ADD CONSTRAINT "dataset_dictionary_items_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_dictionary_items" ADD CONSTRAINT "dataset_dictionary_items_dictionary_item_id_fkey" FOREIGN KEY ("dictionary_item_id") REFERENCES "dictionary_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "dataset_link_dismissals" ADD CONSTRAINT "dataset_link_dismissals_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
