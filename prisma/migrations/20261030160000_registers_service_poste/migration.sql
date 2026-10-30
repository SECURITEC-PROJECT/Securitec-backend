ALTER TABLE "main_courante"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "signalement_logistique"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "ronde"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "consigne_journal"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

UPDATE "main_courante" r
SET "service_poste_id"=COALESCE(p."service_id",p."id")
FROM "prise_de_poste" p
WHERE r."prise_de_poste_id"=p."id" AND r."service_poste_id" IS NULL;
UPDATE "signalement_logistique" r
SET "service_poste_id"=COALESCE(p."service_id",p."id")
FROM "prise_de_poste" p
WHERE r."prise_de_poste_id"=p."id" AND r."service_poste_id" IS NULL;
UPDATE "ronde" r
SET "service_poste_id"=COALESCE(p."service_id",p."id")
FROM "prise_de_poste" p
WHERE r."prise_de_poste_id"=p."id" AND r."service_poste_id" IS NULL;
UPDATE "consigne_journal" r
SET "service_poste_id"=COALESCE(p."service_id",p."id")
FROM "prise_de_poste" p
WHERE r."prise_de_poste_id"=p."id" AND r."service_poste_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "main_courante" ADD CONSTRAINT "fk_main_courante_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "signalement_logistique" ADD CONSTRAINT "fk_signalement_logistique_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ronde" ADD CONSTRAINT "fk_ronde_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "consigne_journal" ADD CONSTRAINT "fk_consigne_journal_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_main_courante_service_poste"
  ON "main_courante" ("service_poste_id", "cree_le" DESC);
CREATE INDEX IF NOT EXISTS "idx_signalement_logistique_service_poste"
  ON "signalement_logistique" ("service_poste_id", "date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_ronde_service_poste"
  ON "ronde" ("service_poste_id", "debut" DESC);
CREATE INDEX IF NOT EXISTS "idx_consigne_journal_service_poste"
  ON "consigne_journal" ("service_poste_id", "date_consigne" DESC);

CREATE OR REPLACE FUNCTION "lier_registre_a_service_poste"() RETURNS TRIGGER AS $$
DECLARE
  linked_service UUID;
  linked_site UUID;
BEGIN
  IF TG_OP='UPDATE' AND OLD."prise_de_poste_id" IS DISTINCT FROM NEW."prise_de_poste_id"
     AND NEW."prise_de_poste_id" IS NULL THEN
    NEW."service_poste_id" := NULL;
  END IF;

  IF NEW."prise_de_poste_id" IS NOT NULL THEN
    SELECT COALESCE(p."service_id",p."id"), sp."site_id"
      INTO linked_service, linked_site
    FROM "prise_de_poste" p
    LEFT JOIN "service_poste" sp ON sp."id"=COALESCE(p."service_id",p."id")
    WHERE p."id"=NEW."prise_de_poste_id";
    IF linked_service IS NULL THEN
      RAISE EXCEPTION 'La prise de poste liée est introuvable.' USING ERRCODE='23503';
    END IF;
    IF linked_site IS NOT NULL AND linked_site<>NEW."site_id" THEN
      RAISE EXCEPTION 'Le service de poste sélectionné appartient à un autre site.' USING ERRCODE='23514';
    END IF;
    IF NEW."service_poste_id" IS NOT NULL AND NEW."service_poste_id"<>linked_service THEN
      RAISE EXCEPTION 'Le service de poste ne correspond pas à la prise de poste.' USING ERRCODE='23514';
    END IF;
    NEW."service_poste_id" := linked_service;
  ELSIF NEW."service_poste_id" IS NOT NULL THEN
    SELECT "site_id" INTO linked_site FROM "service_poste" WHERE "id"=NEW."service_poste_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Le service de poste lié est introuvable.' USING ERRCODE='23503';
    END IF;
    IF linked_site IS NOT NULL AND linked_site<>NEW."site_id" THEN
      RAISE EXCEPTION 'Le service de poste sélectionné appartient à un autre site.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_sync_service_poste" ON "main_courante";
CREATE TRIGGER "trg_sync_service_poste" BEFORE INSERT OR UPDATE OF "prise_de_poste_id","service_poste_id","site_id"
  ON "main_courante" FOR EACH ROW EXECUTE FUNCTION "lier_registre_a_service_poste"();
DROP TRIGGER IF EXISTS "trg_sync_service_poste" ON "signalement_logistique";
CREATE TRIGGER "trg_sync_service_poste" BEFORE INSERT OR UPDATE OF "prise_de_poste_id","service_poste_id","site_id"
  ON "signalement_logistique" FOR EACH ROW EXECUTE FUNCTION "lier_registre_a_service_poste"();
DROP TRIGGER IF EXISTS "trg_sync_service_poste" ON "ronde";
CREATE TRIGGER "trg_sync_service_poste" BEFORE INSERT OR UPDATE OF "prise_de_poste_id","service_poste_id","site_id"
  ON "ronde" FOR EACH ROW EXECUTE FUNCTION "lier_registre_a_service_poste"();
DROP TRIGGER IF EXISTS "trg_sync_service_poste" ON "consigne_journal";
CREATE TRIGGER "trg_sync_service_poste" BEFORE INSERT OR UPDATE OF "prise_de_poste_id","service_poste_id","site_id"
  ON "consigne_journal" FOR EACH ROW EXECUTE FUNCTION "lier_registre_a_service_poste"();
