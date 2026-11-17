-- AlterEnum
DO $$ BEGIN
  ALTER TYPE "PackageType" ADD VALUE 'quarterly';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
