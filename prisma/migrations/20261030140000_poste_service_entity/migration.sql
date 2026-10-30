CREATE TABLE IF NOT EXISTS "service_poste" (
  "id" UUID NOT NULL,
  "site_id" UUID,
  "poste_id" UUID,
  "shift_type" "shift_agent",
  "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(6),
  "ouvert_par" UUID,
  "notes" TEXT,
  CONSTRAINT "service_poste_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "service_poste"
    ADD CONSTRAINT "fk_service_poste_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "service_poste"
    ADD CONSTRAINT "fk_service_poste_poste"
    FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "service_poste"
    ADD CONSTRAINT "fk_service_poste_ouvert_par"
    FOREIGN KEY ("ouvert_par") REFERENCES "utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Reprise des services existants : l'ancien identifiant de groupe est conservé,
-- ce qui préserve notamment les liens des passations déjà enregistrées.
WITH grouped AS (
  SELECT COALESCE(p."service_id", p."id") AS service_id,
         s."id" AS site_id,
         p."poste_id" AS poste_id,
         p."shift_type" AS shift_type,
         p."ouvert_par" AS opened_by,
         p."notes" AS notes,
         MIN(p."started_at") OVER (PARTITION BY COALESCE(p."service_id", p."id")) AS service_started_at,
         MAX(p."ended_at") OVER (PARTITION BY COALESCE(p."service_id", p."id")) AS service_ended_at,
         BOOL_OR(p."ended_at" IS NULL) OVER (PARTITION BY COALESCE(p."service_id", p."id")) AS service_is_open,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(p."service_id", p."id")
           ORDER BY CASE WHEN p."fonction_service" = 'CHEF' THEN 0 ELSE 1 END, p."started_at", p."id"
         ) AS member_order
  FROM "prise_de_poste" p
  LEFT JOIN "site" s ON LOWER(BTRIM(s."nom")) = LOWER(BTRIM(p."site_de_travail"))
), service_roots AS (
  SELECT service_id, site_id, poste_id, shift_type, opened_by, notes,
         service_started_at,
         CASE WHEN service_is_open THEN NULL ELSE service_ended_at END AS service_ended_at
  FROM grouped
  WHERE member_order = 1
)
INSERT INTO "service_poste"
  ("id", "site_id", "poste_id", "shift_type", "started_at", "ended_at", "ouvert_par", "notes")
SELECT service_id, site_id, poste_id, shift_type, service_started_at, service_ended_at, opened_by, notes
FROM service_roots
ON CONFLICT ("id") DO NOTHING;

-- Les anciennes prises individuelles sans groupe deviennent des services d'un seul agent.
UPDATE "prise_de_poste" SET "service_id" = "id" WHERE "service_id" IS NULL;

ALTER TABLE "prise_de_poste" DROP CONSTRAINT IF EXISTS "fk_prise_de_poste_service";
ALTER TABLE "prise_de_poste"
  ADD CONSTRAINT "fk_prise_de_poste_service"
  FOREIGN KEY ("service_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "passation" DROP CONSTRAINT IF EXISTS "fk_passation_prise_de_poste_service";
DO $$ BEGIN
  ALTER TABLE "passation"
    ADD CONSTRAINT "fk_passation_prise_de_poste_service"
    FOREIGN KEY ("prise_de_poste_service_id") REFERENCES "service_poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_service_poste_site_started"
  ON "service_poste" ("site_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_service_poste_poste_status"
  ON "service_poste" ("poste_id", "shift_type", "ended_at");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_service_poste_open_post_shift"
  ON "service_poste" ("poste_id", "shift_type")
  WHERE "ended_at" IS NULL AND "poste_id" IS NOT NULL AND "shift_type" IS NOT NULL;
