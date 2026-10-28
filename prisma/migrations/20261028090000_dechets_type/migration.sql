ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "type_dechet" VARCHAR(20);

ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_type_dechet_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_type_dechet_check"
    CHECK ("type_dechet" IS NULL OR "type_dechet" IN ('LEVURE', 'DRECHE')) NOT VALID;
