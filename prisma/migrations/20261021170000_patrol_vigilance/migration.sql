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
  CONSTRAINT "point_vigilance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_point_vigilance_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_point_vigilance_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "point_vigilance_statut_check" CHECK ("statut" IN ('Conforme', 'Non Conforme', 'RAS'))
);

CREATE INDEX IF NOT EXISTS "idx_point_vigilance_site_date" ON "point_vigilance"("site_id", "cree_le" DESC);
