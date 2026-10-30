ALTER TABLE "main_courante"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_id" UUID;
ALTER TABLE "signalement_logistique"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_id" UUID;
ALTER TABLE "consigne_journal"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_id" UUID,
  ADD COLUMN IF NOT EXISTS "date_fin" DATE,
  ADD COLUMN IF NOT EXISTS "jusquau_nouvel_ordre" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ronde"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "main_courante" ADD CONSTRAINT "fk_main_courante_prise_de_poste"
    FOREIGN KEY ("prise_de_poste_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "signalement_logistique" ADD CONSTRAINT "fk_signalement_logistique_prise_de_poste"
    FOREIGN KEY ("prise_de_poste_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "consigne_journal" ADD CONSTRAINT "fk_consigne_journal_prise_de_poste"
    FOREIGN KEY ("prise_de_poste_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ronde" ADD CONSTRAINT "fk_ronde_prise_de_poste"
    FOREIGN KEY ("prise_de_poste_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

UPDATE "consigne_journal"
SET "date_fin"="date_consigne"
WHERE "date_fin" IS NULL AND "jusquau_nouvel_ordre"=false;

CREATE INDEX IF NOT EXISTS "idx_main_courante_prise_de_poste"
  ON "main_courante" ("prise_de_poste_id", "cree_le" DESC);
CREATE INDEX IF NOT EXISTS "idx_signalement_logistique_prise_de_poste"
  ON "signalement_logistique" ("prise_de_poste_id", "date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_consigne_journal_prise_de_poste"
  ON "consigne_journal" ("prise_de_poste_id", "date_consigne" DESC);
CREATE INDEX IF NOT EXISTS "idx_consigne_journal_active_site"
  ON "consigne_journal" ("site_id", "date_fin") WHERE "jusquau_nouvel_ordre"=true;
CREATE INDEX IF NOT EXISTS "idx_ronde_prise_de_poste"
  ON "ronde" ("prise_de_poste_id", "debut" DESC);
