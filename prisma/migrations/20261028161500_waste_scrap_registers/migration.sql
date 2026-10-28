CREATE TABLE IF NOT EXISTS "registre_ordures" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure" TIME(0) NOT NULL,
  "prenom" VARCHAR(100) NOT NULL,
  "matricule" VARCHAR(50) NOT NULL,
  "section" VARCHAR(100) NOT NULL,
  "designation" TEXT NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "registre_ordures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_registre_ordures_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_registre_ordures_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_registre_ordures_site_date"
  ON "registre_ordures"("site_id","date_operation","heure");

CREATE TABLE IF NOT EXISTS "registre_ferrailles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "heure" TIME(0) NOT NULL,
  "prenom" VARCHAR(100) NOT NULL,
  "matricule" VARCHAR(50) NOT NULL,
  "section" VARCHAR(100) NOT NULL,
  "designation" TEXT NOT NULL,
  "nombre" INTEGER NOT NULL,
  "motif" TEXT NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "registre_ferrailles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registre_ferrailles_nombre_check" CHECK ("nombre" > 0),
  CONSTRAINT "fk_registre_ferrailles_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_registre_ferrailles_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_registre_ferrailles_site_date"
  ON "registre_ferrailles"("site_id","date_operation","heure");
