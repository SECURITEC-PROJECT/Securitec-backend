CREATE TABLE "suivi_cle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_suivi" DATE NOT NULL,
  "lieu" VARCHAR(255) NOT NULL,
  "perception_matin" TIME(0),
  "responsable_perception_matin" VARCHAR(255),
  "reintegration_matin" TIME(0),
  "responsable_reintegration_matin" VARCHAR(255),
  "perception_apres_midi" TIME(0),
  "responsable_perception_apres_midi" VARCHAR(255),
  "reintegration_apres_midi" TIME(0),
  "responsable_reintegration_apres_midi" VARCHAR(255),
  "observations" TEXT,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "suivi_cle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_suivi_cle_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_suivi_cle_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_suivi_cle_site_date" ON "suivi_cle"("site_id", "date_suivi");

CREATE TABLE "controle_alcoolemie" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_controle" DATE NOT NULL,
  "heure" TIME(0) NOT NULL,
  "personne" VARCHAR(255) NOT NULL,
  "appartenance" VARCHAR(40) NOT NULL,
  "demandeur" VARCHAR(255),
  "type_demande" VARCHAR(80) NOT NULL,
  "resultat" VARCHAR(20) NOT NULL,
  "taux_mesure" DECIMAL(5,2),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "controle_alcoolemie_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_controle_alcoolemie_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_controle_alcoolemie_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "controle_alcoolemie_resultat_check" CHECK ("resultat" IN ('Positif', 'Négatif')),
  CONSTRAINT "controle_alcoolemie_appartenance_check" CHECK ("appartenance" IN ('STAR', 'NON STAR')),
  CONSTRAINT "controle_alcoolemie_taux_check" CHECK ("taux_mesure" IS NULL OR "taux_mesure" >= 0)
);
CREATE INDEX "idx_alcoolemie_site_date" ON "controle_alcoolemie"("site_id", "date_controle", "heure");
