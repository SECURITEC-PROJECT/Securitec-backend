CREATE TABLE IF NOT EXISTS "mouvement_velo" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "matricule" VARCHAR(50) NOT NULL,
  "prenom" VARCHAR(100) NOT NULL,
  "section" VARCHAR(100) NOT NULL,
  "marque_velo" VARCHAR(255) NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "mouvement_velo_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mouvement_velo_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_velo_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mouvement_velo_site_date"
  ON "mouvement_velo"("site_id","date_operation","heure_entree");

CREATE TABLE IF NOT EXISTS "mouvement_moto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure_entree" TIME(0) NOT NULL,
  "moto" VARCHAR(255) NOT NULL,
  "observation" TEXT NOT NULL,
  "heure_sortie" TIME(0),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "mouvement_moto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_mouvement_moto_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_moto_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mouvement_moto_site_date"
  ON "mouvement_moto"("site_id","date_operation","heure_entree");
