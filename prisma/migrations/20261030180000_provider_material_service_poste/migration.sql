ALTER TABLE "materiel_sous_traitant"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "materiel_star"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "materiel_sous_traitant" ADD CONSTRAINT "fk_materiel_sous_traitant_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "materiel_star" ADD CONSTRAINT "fk_materiel_star_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_materiel_sous_traitant_service_poste"
  ON "materiel_sous_traitant" ("service_poste_id", "date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_materiel_star_service_poste"
  ON "materiel_star" ("service_poste_id", "date_operation" DESC);
