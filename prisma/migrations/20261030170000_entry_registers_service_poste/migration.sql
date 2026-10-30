ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "mouvement_courrier"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;
ALTER TABLE "controle_alcoolemie"
  ADD COLUMN IF NOT EXISTS "service_poste_id" UUID;

-- Les mouvements de véhicule déjà rattachés à une vacation sont rapprochés
-- du service du même poste qui était actif à l'heure d'entrée.
UPDATE "passage_vehicule" pv
SET "service_poste_id" = (
  SELECT sp."id"
  FROM "vacation" v
  JOIN "service_poste" sp ON sp."site_id"=COALESCE(pv."site_id",v."site_id")
  JOIN "poste" po ON po."id"=sp."poste_id" AND LOWER(BTRIM(po."nom"))=LOWER(BTRIM(v."poste_nom"))
  WHERE v."id"=pv."vacation_id"
    AND (v."shift_type" IS NULL OR sp."shift_type"=v."shift_type")
    AND sp."started_at"<=pv."entree"
    AND (sp."ended_at" IS NULL OR sp."ended_at">=pv."entree")
  ORDER BY sp."started_at" DESC
  LIMIT 1
)
WHERE pv."service_poste_id" IS NULL AND pv."vacation_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "passage_vehicule" ADD CONSTRAINT "fk_passagevehicule_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "mouvement_courrier" ADD CONSTRAINT "fk_mouvement_courrier_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "controle_alcoolemie" ADD CONSTRAINT "fk_controle_alcoolemie_service_poste"
    FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "idx_passage_vehicule_service_poste"
  ON "passage_vehicule" ("service_poste_id", "entree" DESC);
CREATE INDEX IF NOT EXISTS "idx_mouvement_courrier_service_poste"
  ON "mouvement_courrier" ("service_poste_id", "date_operation" DESC);
CREATE INDEX IF NOT EXISTS "idx_alcoolemie_service_poste"
  ON "controle_alcoolemie" ("service_poste_id", "date_controle" DESC);
