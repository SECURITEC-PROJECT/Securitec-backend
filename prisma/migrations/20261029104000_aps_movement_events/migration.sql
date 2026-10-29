CREATE TABLE IF NOT EXISTS "mouvement_aps_evenement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "mouvement" VARCHAR(500) NOT NULL,
  "observation" VARCHAR(1000) NOT NULL DEFAULT '',
  "heure_sortie" TIME(0),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mouvement_aps_evenement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mouvement_aps_evenement_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_aps_evenement_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mouvement_aps_evenement_site_date"
  ON "mouvement_aps_evenement"("site_id","date_operation","heure_entree");
