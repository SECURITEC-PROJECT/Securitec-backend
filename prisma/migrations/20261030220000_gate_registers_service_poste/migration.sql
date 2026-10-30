ALTER TABLE "passage"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "registre_ordures"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "registre_ferrailles"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "mouvement_velo"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "mouvement_moto"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "passage" ADD CONSTRAINT "fk_passage_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "registre_ordures" ADD CONSTRAINT "fk_registre_ordures_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "registre_ferrailles" ADD CONSTRAINT "fk_registre_ferrailles_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvement_velo" ADD CONSTRAINT "fk_mouvement_velo_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvement_moto" ADD CONSTRAINT "fk_mouvement_moto_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_passage_service_poste" ON "passage" ("service_poste_id","entree" DESC);
CREATE INDEX IF NOT EXISTS "idx_registre_ordures_service_poste" ON "registre_ordures" ("service_poste_id","date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_registre_ferrailles_service_poste" ON "registre_ferrailles" ("service_poste_id","date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_mouvement_velo_service_poste" ON "mouvement_velo" ("service_poste_id","date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_mouvement_moto_service_poste" ON "mouvement_moto" ("service_poste_id","date_operation" DESC);
