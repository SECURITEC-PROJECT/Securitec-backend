ALTER TABLE "prise_de_poste"
  ADD COLUMN IF NOT EXISTS "poste_id" UUID,
  ADD COLUMN IF NOT EXISTS "service_id" UUID,
  ADD COLUMN IF NOT EXISTS "shift_type" "shift_agent",
  ADD COLUMN IF NOT EXISTS "fonction_service" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "ouvert_par" UUID;

ALTER TABLE "passation"
  ADD COLUMN IF NOT EXISTS "prise_de_poste_service_id" UUID;

-- Certaines bases existantes ont la table poste sans le champ present dans le schéma Prisma.
ALTER TABLE "poste"
  ADD COLUMN IF NOT EXISTS "actif" BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE "prise_de_poste"
    ADD CONSTRAINT "fk_prise_de_poste_poste"
    FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "passation"
    ADD CONSTRAINT "fk_passation_prise_de_poste_service"
    FOREIGN KEY ("prise_de_poste_service_id") REFERENCES "prise_de_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prise_de_poste"
    ADD CONSTRAINT "fk_prise_de_poste_service"
    FOREIGN KEY ("service_id") REFERENCES "prise_de_poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prise_de_poste"
    ADD CONSTRAINT "fk_prise_de_poste_ouvert_par"
    FOREIGN KEY ("ouvert_par") REFERENCES "utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "prise_de_poste"
    ADD CONSTRAINT "prise_de_poste_fonction_check"
    CHECK ("fonction_service" IS NULL OR "fonction_service" IN ('CHEF', 'AGENT'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_prise_de_poste_service"
  ON "prise_de_poste" ("service_id", "started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prise_de_poste_open_group_employee"
  ON "prise_de_poste" (UPPER(BTRIM("matricule")))
  WHERE "ended_at" IS NULL AND "service_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_prise_de_poste_poste_open"
  ON "prise_de_poste" ("poste_id", "shift_type") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_prise_de_poste_open_post_shift"
  ON "prise_de_poste" ("poste_id", "shift_type")
  WHERE "ended_at" IS NULL AND "fonction_service" = 'CHEF' AND "poste_id" IS NOT NULL;

INSERT INTO "poste" ("nom", "actif", "site_id")
SELECT names.nom, true, s."id"
FROM "site" s
CROSS JOIN (VALUES ('PG Principal'), ('PG2'), ('PG3'), ('PG4'), ('PG5'), ('PG6')) AS names(nom)
WHERE s."actif" = true
  AND NOT EXISTS (
    SELECT 1 FROM "poste" existing
    WHERE existing."site_id"=s."id" AND existing."nom"=names.nom
  );
