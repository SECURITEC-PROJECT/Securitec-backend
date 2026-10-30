CREATE TABLE "transporteur" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nom_transporteur" VARCHAR(255) NOT NULL,
  "vehicule" VARCHAR(160) NOT NULL,
  "matricule" VARCHAR(40),
  "telephone" VARCHAR(40),
  "chauffeur" VARCHAR(255),
  "observation" TEXT,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transporteur_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transporteur_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "transporteur_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "transporteur_site_nom_vehicule_idx"
  ON "transporteur"("site_id", "nom_transporteur", "vehicule");
