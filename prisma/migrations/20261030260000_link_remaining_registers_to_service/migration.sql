ALTER TABLE "point_vigilance"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "questionnaire_visiteur"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "declaration_objet"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "point_vigilance" ADD CONSTRAINT "fk_point_vigilance_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "questionnaire_visiteur" ADD CONSTRAINT "fk_questionnaire_visiteur_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "declaration_objet" ADD CONSTRAINT "fk_declaration_objet_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE "point_vigilance" entry
SET "service_poste_id" = (
  SELECT service."id" FROM "service_poste" service
  WHERE service."site_id"=entry."site_id"
    AND service."started_at"<=entry."cree_le"
    AND (service."ended_at" IS NULL OR service."ended_at">=entry."cree_le")
  ORDER BY service."started_at" DESC LIMIT 1
)
WHERE entry."service_poste_id" IS NULL;
UPDATE "questionnaire_visiteur" entry
SET "service_poste_id" = (
  SELECT service."id" FROM "service_poste" service
  WHERE service."site_id"=entry."site_id"
    AND service."started_at"<=entry."cree_le"
    AND (service."ended_at" IS NULL OR service."ended_at">=entry."cree_le")
  ORDER BY service."started_at" DESC LIMIT 1
)
WHERE entry."service_poste_id" IS NULL;
UPDATE "declaration_objet" entry
SET "service_poste_id" = (
  SELECT service."id" FROM "service_poste" service
  WHERE service."site_id"=entry."site_id"
    AND service."started_at"<=entry."cree_le"
    AND (service."ended_at" IS NULL OR service."ended_at">=entry."cree_le")
  ORDER BY service."started_at" DESC LIMIT 1
)
WHERE entry."service_poste_id" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_point_vigilance_service_poste"
  ON "point_vigilance" ("service_poste_id", "cree_le" DESC);
CREATE INDEX IF NOT EXISTS "idx_questionnaire_visiteur_service_poste"
  ON "questionnaire_visiteur" ("service_poste_id", "date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_declaration_objet_service_poste"
  ON "declaration_objet" ("service_poste_id", "date_operation" DESC);
