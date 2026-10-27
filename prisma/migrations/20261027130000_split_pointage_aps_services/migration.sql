CREATE TABLE IF NOT EXISTS "pointage_aps_jour" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "date_pointage" DATE NOT NULL,
  "data" JSONB NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pointage_aps_jour_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_pointage_aps_jour_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_pointage_aps_jour_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pointage_aps_jour_site_date"
  ON "pointage_aps_jour"("site_id", "date_pointage");
CREATE INDEX IF NOT EXISTS "idx_pointage_aps_jour_site_date"
  ON "pointage_aps_jour"("site_id", "date_pointage");

CREATE TABLE IF NOT EXISTS "pointage_aps_nuit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "date_pointage" DATE NOT NULL,
  "data" JSONB NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pointage_aps_nuit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_pointage_aps_nuit_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_pointage_aps_nuit_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_pointage_aps_nuit_site_date"
  ON "pointage_aps_nuit"("site_id", "date_pointage");
CREATE INDEX IF NOT EXISTS "idx_pointage_aps_nuit_site_date"
  ON "pointage_aps_nuit"("site_id", "date_pointage");

INSERT INTO "pointage_aps_jour" ("site_id", "date_pointage", "data", "utilisateur_id", "updated_at")
SELECT "site_id", "date_pointage", "data", "utilisateur_id", "updated_at"
FROM "pointage_aps" WHERE "service"='jour'
ON CONFLICT ("site_id", "date_pointage") DO NOTHING;

INSERT INTO "pointage_aps_nuit" ("site_id", "date_pointage", "data", "utilisateur_id", "updated_at")
SELECT "site_id", "date_pointage", "data", "utilisateur_id", "updated_at"
FROM "pointage_aps" WHERE "service"='nuit'
ON CONFLICT ("site_id", "date_pointage") DO NOTHING;
