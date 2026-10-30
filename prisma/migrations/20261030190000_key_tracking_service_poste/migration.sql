ALTER TABLE "suivi_cle"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "suivi_cle" ADD CONSTRAINT "fk_suivi_cle_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_suivi_cle_service_poste"
  ON "suivi_cle" ("service_poste_id", "date_suivi" DESC);
