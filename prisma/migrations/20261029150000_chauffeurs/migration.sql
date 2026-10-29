CREATE TABLE IF NOT EXISTS "chauffeur" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nom_prenom" VARCHAR(255) NOT NULL,
  "telephone" VARCHAR(40),
  "cin" VARCHAR(80),
  "numero_permis" VARCHAR(100),
  "expiration_permis" DATE,
  "transporteur" VARCHAR(255),
  "vehicule" VARCHAR(160),
  "matricule" VARCHAR(40),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chauffeur_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chauffeur_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chauffeur_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "chauffeur_site_nom_idx"
  ON "chauffeur"("site_id", "nom_prenom");
