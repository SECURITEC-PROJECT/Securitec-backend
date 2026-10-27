CREATE TABLE IF NOT EXISTS "materiel_sous_traitant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "materiels" TEXT NOT NULL,
  "nombre" INTEGER NOT NULL,
  "entreprise" VARCHAR(255) NOT NULL,
  "heure_sortie" TIME(0),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "materiel_sous_traitant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_materiel_sous_traitant_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_materiel_sous_traitant_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_materiel_sous_traitant_site_date"
  ON "materiel_sous_traitant"("site_id", "date_operation", "heure_entree");
