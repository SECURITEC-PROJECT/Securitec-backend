CREATE TABLE IF NOT EXISTS "mouvement_aps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "date_pointage" DATE NOT NULL,
  "service" VARCHAR(10) NOT NULL,
  "data" JSONB NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mouvement_aps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mouvement_aps_service_check" CHECK ("service" IN ('jour', 'nuit')),
  CONSTRAINT "fk_mouvement_aps_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_aps_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mouvement_aps_site_date_service"
  ON "mouvement_aps"("site_id","date_pointage","service");
CREATE INDEX IF NOT EXISTS "idx_mouvement_aps_site_date"
  ON "mouvement_aps"("site_id","date_pointage");

CREATE TABLE IF NOT EXISTS "configuration_postes_mouvement_aps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "service" VARCHAR(10) NOT NULL,
  "postes" JSONB NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuration_postes_mouvement_aps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "configuration_postes_mouvement_aps_service_check" CHECK ("service" IN ('jour', 'nuit')),
  CONSTRAINT "fk_configuration_postes_mouvement_aps_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_configuration_postes_mouvement_aps_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_configuration_postes_mouvement_aps_site_service"
  ON "configuration_postes_mouvement_aps"("site_id","service");
