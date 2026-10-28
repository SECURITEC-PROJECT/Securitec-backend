CREATE TABLE IF NOT EXISTS "materiel_star" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "prenom" VARCHAR(255) NOT NULL,
  "matricule" VARCHAR(100) NOT NULL,
  "materiels" JSONB NOT NULL,
  "heure_sortie" TIME(0),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "materiel_star_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "materiel_star_materiels_check"
    CHECK (jsonb_typeof("materiels") = 'array' AND jsonb_array_length("materiels") BETWEEN 1 AND 100),
  CONSTRAINT "fk_materiel_star_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_materiel_star_utilisateur"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_materiel_star_site_date"
  ON "materiel_star"("site_id", "date_operation", "heure_entree");
