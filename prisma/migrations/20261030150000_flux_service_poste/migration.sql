ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

UPDATE "flux_logistique" f
SET "service_poste_id" = COALESCE(p."service_id", p."id")
FROM "prise_de_poste" p
WHERE f."prise_de_poste_id" = p."id"
  AND f."service_poste_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "flux_logistique"
    ADD CONSTRAINT "fk_flux_logistique_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_flux_logistique_service_poste"
  ON "flux_logistique" ("service_poste_id", "date_operation" DESC);

-- Keep the explicit service link synchronized while the legacy member link remains in use.
CREATE OR REPLACE FUNCTION "lier_flux_a_service_poste"() RETURNS TRIGGER AS $$
DECLARE
  linked_service UUID;
  linked_site UUID;
BEGIN
  IF NEW."prise_de_poste_id" IS NOT NULL THEN
    SELECT COALESCE(p."service_id", p."id"), s."site_id"
      INTO linked_service, linked_site
    FROM "prise_de_poste" p
    LEFT JOIN "service_poste" s ON s."id" = COALESCE(p."service_id", p."id")
    WHERE p."id" = NEW."prise_de_poste_id";

    IF linked_service IS NULL THEN
      RAISE EXCEPTION 'La prise de poste liée est introuvable.' USING ERRCODE = '23503';
    END IF;
    IF linked_site IS NOT NULL AND linked_site <> NEW."site_id" THEN
      RAISE EXCEPTION 'Le service de poste sélectionné appartient à un autre site.' USING ERRCODE = '23514';
    END IF;
    IF NEW."service_poste_id" IS NOT NULL AND NEW."service_poste_id" <> linked_service THEN
      RAISE EXCEPTION 'Le service de poste ne correspond pas à la prise de poste.' USING ERRCODE = '23514';
    END IF;
    NEW."service_poste_id" := linked_service;
  ELSIF NEW."service_poste_id" IS NOT NULL THEN
    SELECT "site_id" INTO linked_site FROM "service_poste" WHERE "id" = NEW."service_poste_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Le service de poste lié est introuvable.' USING ERRCODE = '23503';
    END IF;
    IF linked_site IS NOT NULL AND linked_site <> NEW."site_id" THEN
      RAISE EXCEPTION 'Le service de poste sélectionné appartient à un autre site.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_sync_flux_service_poste" ON "flux_logistique";
CREATE TRIGGER "trg_sync_flux_service_poste"
BEFORE INSERT OR UPDATE OF "prise_de_poste_id", "service_poste_id", "site_id" ON "flux_logistique"
FOR EACH ROW EXECUTE FUNCTION "lier_flux_a_service_poste"();
