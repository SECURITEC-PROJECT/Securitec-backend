-- Complete the register table when an older partial version already exists.
CREATE TABLE IF NOT EXISTS "main_courante" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type_entree" VARCHAR(40) NOT NULL DEFAULT 'STANDARD',
  "category" VARCHAR(80) NOT NULL DEFAULT 'Information',
  "severity" VARCHAR(20) NOT NULL DEFAULT 'normal',
  "zone" VARCHAR(255),
  "people" VARCHAR(255),
  "statut_auteur" VARCHAR(80),
  "nature_violation" VARCHAR(160),
  "description" TEXT NOT NULL DEFAULT '',
  "mesures_prises" TEXT,
  "heure" TIME(0) NOT NULL DEFAULT CURRENT_TIME,
  "site_id" UUID,
  "utilisateur_id" UUID,
  CONSTRAINT "main_courante_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "main_courante"
  ADD COLUMN IF NOT EXISTS "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "type_entree" VARCHAR(40) NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN IF NOT EXISTS "category" VARCHAR(80) NOT NULL DEFAULT 'Information',
  ADD COLUMN IF NOT EXISTS "severity" VARCHAR(20) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS "zone" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "people" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "statut_auteur" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "nature_violation" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "mesures_prises" TEXT,
  ADD COLUMN IF NOT EXISTS "heure" TIME(0) NOT NULL DEFAULT CURRENT_TIME,
  ADD COLUMN IF NOT EXISTS "site_id" UUID,
  ADD COLUMN IF NOT EXISTS "utilisateur_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_main_courante_site_date"
  ON "main_courante"("site_id", "cree_le" DESC);
