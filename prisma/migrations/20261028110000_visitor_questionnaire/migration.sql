CREATE TABLE IF NOT EXISTS "questionnaire_visiteur" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "donnees" JSONB NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "questionnaire_visiteur_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_questionnaire_visiteur_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_questionnaire_visiteur_utilisateur"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_questionnaire_visiteur_site_date"
  ON "questionnaire_visiteur"("site_id", "date_operation", "cree_le");
