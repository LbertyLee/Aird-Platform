CREATE TYPE "LocationKind" AS ENUM ('country', 'region');

ALTER TABLE "dictionary_items"
ADD COLUMN "location_kind" "LocationKind";

UPDATE "dictionary_items"
SET "location_kind" = 'country'
WHERE "type" = 'country_region';

UPDATE "dictionary_items"
SET "location_kind" = 'region'
WHERE "type" = 'country_region'
  AND "code" IN ('ASEAN', 'EU');
