ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_id" UUID,
  ADD COLUMN IF NOT EXISTS "modifie_par" UUID,
  ADD COLUMN IF NOT EXISTS "annule_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
  ADD COLUMN IF NOT EXISTS "type_document" VARCHAR(30),
  ADD COLUMN IF NOT EXISTS "emetteur" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "verification" TEXT,
  ADD COLUMN IF NOT EXISTS "visa_agent" VARCHAR(255);

DO $$ BEGIN
  ALTER TABLE "flux_logistique"
    ADD CONSTRAINT "fk_flux_logistique_prise_de_poste"
    FOREIGN KEY ("prise_de_poste_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flux_logistique"
    ADD CONSTRAINT "fk_flux_logistique_modifie_par"
    FOREIGN KEY ("modifie_par") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_flux_logistique_client_request_id"
  ON "flux_logistique" ("client_request_id") WHERE "client_request_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_flux_logistique_shift"
  ON "flux_logistique" ("prise_de_poste_id") WHERE "prise_de_poste_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_flux_logistique_active_site_date"
  ON "flux_logistique" ("site_id", "date_operation" DESC) WHERE "annule_le" IS NULL;

CREATE OR REPLACE FUNCTION "lier_flux_a_prise_de_poste"() RETURNS TRIGGER AS $$
DECLARE
  prise_active UUID;
BEGIN
  IF NEW."prise_de_poste_id" IS NULL THEN
    prise_active := NULLIF(current_setting('app.prise_de_poste_id', true), '')::uuid;
    IF prise_active IS NOT NULL THEN
      SELECT p."id" INTO NEW."prise_de_poste_id"
      FROM "prise_de_poste" p
      JOIN "site" s ON s."id" = NEW."site_id"
      WHERE p."id" = prise_active
        AND LOWER(BTRIM(p."site_de_travail")) = LOWER(BTRIM(s."nom"));
      IF NEW."prise_de_poste_id" IS NULL THEN
        RAISE EXCEPTION 'La prise de poste sélectionnée appartient à un autre site.' USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT p."id" INTO NEW."prise_de_poste_id"
      FROM "prise_de_poste" p
      JOIN "site" s ON s."id" = NEW."site_id"
      WHERE p."ended_at" IS NULL
        AND LOWER(BTRIM(p."site_de_travail")) = LOWER(BTRIM(s."nom"))
      ORDER BY p."started_at" DESC
      LIMIT 1;
    END IF;
  END IF;
  IF NEW."client_request_id" IS NULL THEN
    NEW."client_request_id" := NULLIF(current_setting('app.client_request_id', true), '')::uuid;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_lier_flux_a_prise_de_poste" ON "flux_logistique";
CREATE TRIGGER "trg_lier_flux_a_prise_de_poste"
BEFORE INSERT ON "flux_logistique"
FOR EACH ROW EXECUTE FUNCTION "lier_flux_a_prise_de_poste"();

CREATE TABLE IF NOT EXISTS "audit_flux_logistique" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flux_id" UUID NOT NULL,
  "utilisateur_id" UUID,
  "action" VARCHAR(20) NOT NULL,
  "avant" JSONB NOT NULL,
  "apres" JSONB NOT NULL,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_flux_logistique_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_audit_flux_logistique_entry" FOREIGN KEY ("flux_id") REFERENCES "flux_logistique"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_audit_flux_logistique_user" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "audit_flux_logistique_action_check" CHECK ("action" IN ('MODIFICATION', 'ANNULATION'))
);
CREATE INDEX IF NOT EXISTS "idx_audit_flux_logistique_entry_date"
  ON "audit_flux_logistique" ("flux_id", "cree_le" DESC);

CREATE OR REPLACE FUNCTION "journaliser_flux_logistique"() RETURNS TRIGGER AS $$
DECLARE
  action_audit VARCHAR(20);
  acteur UUID;
BEGIN
  acteur := COALESCE(
    NEW."modifie_par",
    NULLIF(current_setting('app.user_id', true), '')::uuid,
    OLD."utilisateur_id"
  );
  action_audit := CASE WHEN OLD."annule_le" IS NULL AND NEW."annule_le" IS NOT NULL THEN 'ANNULATION' ELSE 'MODIFICATION' END;
  INSERT INTO "audit_flux_logistique" ("flux_id", "utilisateur_id", "action", "avant", "apres")
  VALUES (OLD."id", acteur, action_audit, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_audit_flux_logistique" ON "flux_logistique";
CREATE TRIGGER "trg_audit_flux_logistique"
AFTER UPDATE ON "flux_logistique"
FOR EACH ROW EXECUTE FUNCTION "journaliser_flux_logistique"();

CREATE TABLE IF NOT EXISTS "flux_logistique_document" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flux_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flux_logistique_document_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "flux_logistique_document_flux_id_document_id_key" UNIQUE ("flux_id", "document_id"),
  CONSTRAINT "fk_flux_logistique_document_flux" FOREIGN KEY ("flux_id") REFERENCES "flux_logistique"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_flux_logistique_document_document" FOREIGN KEY ("document_id") REFERENCES "document_site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_flux_logistique_document_user" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_flux_logistique_document_flux"
  ON "flux_logistique_document" ("flux_id", "cree_le");
