WITH ranked_configurations AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY site_id
           ORDER BY (service = 'jour') DESC, updated_at DESC, id
         ) AS row_number
  FROM "configuration_postes_mouvement_aps"
)
DELETE FROM "configuration_postes_mouvement_aps" AS configuration
USING ranked_configurations
WHERE configuration.id = ranked_configurations.id
  AND ranked_configurations.row_number > 1;

ALTER TABLE "configuration_postes_mouvement_aps"
  DROP CONSTRAINT IF EXISTS "configuration_postes_mouvement_aps_service_check";

DROP INDEX IF EXISTS "uq_configuration_postes_mouvement_aps_site_service";

ALTER TABLE "configuration_postes_mouvement_aps"
  DROP COLUMN IF EXISTS "service";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_configuration_postes_mouvement_aps_site"
  ON "configuration_postes_mouvement_aps"("site_id");
