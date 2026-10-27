CREATE TABLE IF NOT EXISTS "mouvement_courrier" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "prenom" VARCHAR(255) NOT NULL,
  "designation" TEXT NOT NULL,
  "nombre" INTEGER NOT NULL,
  "heure_sortie" TIME(0),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "mouvement_courrier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mouvement_courrier_nombre_check" CHECK ("nombre" >= 1),
  CONSTRAINT "fk_mouvement_courrier_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_courrier_utilisateur"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mouvement_courrier_site_date"
  ON "mouvement_courrier"("site_id", "date_operation", "heure_entree");
