ALTER TABLE "chauffeur" ADD COLUMN "prestataire_id" UUID;

ALTER TABLE "chauffeur"
  ADD CONSTRAINT "fk_chauffeur_prestataire"
  FOREIGN KEY ("prestataire_id") REFERENCES "prestataire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_chauffeur_prestataire_site"
  ON "chauffeur" ("prestataire_id", "site_id");
