ALTER TABLE "registre_ordures"
  ADD COLUMN "observation" TEXT;

UPDATE "registre_ordures"
SET "observation" = "designation"
WHERE "observation" IS NULL;

ALTER TABLE "registre_ordures"
  ALTER COLUMN "observation" SET NOT NULL;
