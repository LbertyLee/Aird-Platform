ALTER TYPE "SourceOrigin" RENAME VALUE 'BRAVE' TO 'EXA';

ALTER TABLE "ResearchRun" RENAME COLUMN "usedBrave" TO "usedExa";
