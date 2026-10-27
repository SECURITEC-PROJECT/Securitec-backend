ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "passagers_sortie" INTEGER;

ALTER TABLE "passage_vehicule"
  ADD CONSTRAINT "passage_vehicule_passagers_sortie_check"
  CHECK ("passagers_sortie" IS NULL OR "passagers_sortie" >= 0) NOT VALID;
