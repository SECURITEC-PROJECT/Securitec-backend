CREATE TABLE IF NOT EXISTS "mouvement_aps_passation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "materiel" VARCHAR(3000) NOT NULL DEFAULT '',
  "chaine_est" VARCHAR(100) NOT NULL DEFAULT '',
  "chaine_ouest" VARCHAR(100) NOT NULL DEFAULT '',
  "cles_rendus" VARCHAR(5000) NOT NULL DEFAULT '',
  "cles_non_rendus" VARCHAR(5000) NOT NULL DEFAULT '',
  "etat_des_lieux" VARCHAR(5000) NOT NULL DEFAULT '',
  "consigne" VARCHAR(5000) NOT NULL DEFAULT '',
  "evenement" VARCHAR(5000) NOT NULL DEFAULT '',
  "remarque" VARCHAR(5000) NOT NULL DEFAULT '',
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mouvement_aps_passation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_passation_service_aps_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_passation_service_aps_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_passation_service_aps_site_date"
  ON "mouvement_aps_passation"("site_id","date_operation");
