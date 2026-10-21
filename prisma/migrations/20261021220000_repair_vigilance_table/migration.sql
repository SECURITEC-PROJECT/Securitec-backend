-- Make the vigilance register complete even when an older partial table exists.
CREATE TABLE IF NOT EXISTS "point_vigilance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type_point" VARCHAR(160) NOT NULL,
  "element_verifie" VARCHAR(255) NOT NULL,
  "statut" VARCHAR(40) NOT NULL,
  "observations" TEXT,
  "heure" TIME(0) NOT NULL,
  "agent_nom" VARCHAR(255) NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "point_vigilance_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "point_vigilance"
  ADD COLUMN IF NOT EXISTS "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "type_point" VARCHAR(160) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "element_verifie" VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "statut" VARCHAR(40) NOT NULL DEFAULT 'RAS',
  ADD COLUMN IF NOT EXISTS "observations" TEXT,
  ADD COLUMN IF NOT EXISTS "heure" TIME(0) NOT NULL DEFAULT CURRENT_TIME,
  ADD COLUMN IF NOT EXISTS "agent_nom" VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "site_id" UUID,
  ADD COLUMN IF NOT EXISTS "utilisateur_id" UUID;

CREATE INDEX IF NOT EXISTS "idx_point_vigilance_site_date"
  ON "point_vigilance"("site_id", "cree_le" DESC);
