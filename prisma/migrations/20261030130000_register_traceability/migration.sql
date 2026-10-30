ALTER TABLE "mouvement_velo"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "mouvement_moto"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "mouvement_courrier"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "controle_alcoolemie"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "materiel_sous_traitant"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "materiel_star"
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "annule_par" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;
ALTER TABLE "prestataire"
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID;

CREATE TABLE IF NOT EXISTS "audit_registre" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entite" VARCHAR(80) NOT NULL,
  "entite_id" TEXT NOT NULL,
  "site_id" UUID,
  "action" VARCHAR(20) NOT NULL,
  "avant" JSONB,
  "apres" JSONB,
  "utilisateur_id" UUID,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_registre_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_registre_action_check" CHECK ("action" IN ('MODIFICATION','ANNULATION','DESACTIVATION'))
);
CREATE INDEX IF NOT EXISTS "idx_audit_registre_entity_date"
  ON "audit_registre" ("entite", "entite_id", "cree_le" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_registre_site_date"
  ON "audit_registre" ("site_id", "cree_le" DESC);

CREATE TABLE IF NOT EXISTS "document_registre" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "entite" VARCHAR(80) NOT NULL,
  "entite_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_registre_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_document_registre_link" UNIQUE ("entite", "entite_id", "document_id"),
  CONSTRAINT "fk_document_registre_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_document_registre_document" FOREIGN KEY ("document_id") REFERENCES "document_site"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_document_registre_user" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS "idx_document_registre_entry"
  ON "document_registre" ("entite", "entite_id", "cree_le" DESC);

CREATE OR REPLACE FUNCTION "audit_register_change"() RETURNS trigger AS $$
DECLARE
  before_row JSONB := to_jsonb(OLD);
  after_row JSONB := to_jsonb(NEW);
  actor_id UUID;
  action_name VARCHAR(20) := 'MODIFICATION';
BEGIN
  actor_id := COALESCE(
    NULLIF(current_setting('securitec.user_id', true), '')::uuid,
    NULLIF(after_row->>'modifie_par', '')::uuid,
    NULLIF(before_row->>'utilisateur_id', '')::uuid,
    NULLIF(before_row->>'saisi_par_id', '')::uuid,
    NULLIF(before_row->>'saisiParId', '')::uuid
  );
  IF (before_row ? 'annule_le') AND before_row->>'annule_le' IS NULL AND after_row->>'annule_le' IS NOT NULL THEN
    action_name := 'ANNULATION';
  ELSIF (before_row ? 'actif') AND before_row->>'actif' = 'true' AND after_row->>'actif' = 'false' THEN
    action_name := 'DESACTIVATION';
  END IF;
  INSERT INTO "audit_registre" ("entite", "entite_id", "site_id", "action", "avant", "apres", "utilisateur_id")
  VALUES (
    TG_ARGV[0], after_row->>'id', NULLIF(after_row->>'site_id', '')::uuid,
    action_name, before_row, after_row, actor_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'mouvement_velo', 'mouvement_moto', 'mouvement_courrier',
    'passage_vehicule', 'controle_alcoolemie', 'passation',
    'materiel_sous_traitant', 'materiel_star', 'prestataire'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_audit_register_' || table_name, table_name);
    EXECUTE format(
      'CREATE TRIGGER %I AFTER UPDATE ON %I FOR EACH ROW WHEN (to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW)) EXECUTE FUNCTION audit_register_change(%L)',
      'trg_audit_register_' || table_name, table_name, table_name
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS "idx_mouvement_velo_site_date_active"
  ON "mouvement_velo" ("site_id", "date_operation" DESC) WHERE "annule_le" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_mouvement_moto_site_date_active"
  ON "mouvement_moto" ("site_id", "date_operation" DESC) WHERE "annule_le" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_mouvement_courrier_site_date_active"
  ON "mouvement_courrier" ("site_id", "date_operation" DESC) WHERE "annule_le" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_passage_vehicule_site_entry_active"
  ON "passage_vehicule" ("site_id", "entree" DESC) WHERE "annule_le" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_controle_alcoolemie_site_date_active"
  ON "controle_alcoolemie" ("site_id", "date_controle" DESC) WHERE "annule_le" IS NULL;
