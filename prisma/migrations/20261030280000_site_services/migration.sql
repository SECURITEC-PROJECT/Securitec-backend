CREATE TABLE "service_site" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "nom" VARCHAR(160) NOT NULL,
  "departement" VARCHAR(160) NOT NULL DEFAULT '',
  "responsable" VARCHAR(160) NOT NULL DEFAULT '',
  "actif" BOOLEAN NOT NULL DEFAULT true,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_site_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_service_site_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_service_site_site_nom" ON "service_site"("site_id", "nom");
CREATE INDEX "idx_service_site_site_actif" ON "service_site"("site_id", "actif", "nom");
