-- The migration ledger reports these workflow migrations as applied, while their
-- schema changes are absent from the live database. Reconcile them idempotently.
ALTER TABLE "passage"
  ADD COLUMN IF NOT EXISTS "type_piece" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "piece_fin" VARCHAR(4),
  ADD COLUMN IF NOT EXISTS "hote" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "zone" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "materiel" TEXT,
  ADD COLUMN IF NOT EXISTS "immatriculation" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "notes_sortie" TEXT,
  ADD COLUMN IF NOT EXISTS "badge_numero" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "saisi_par_id" UUID,
  ADD COLUMN IF NOT EXISTS "sortie_par_id" UUID;

ALTER TABLE "vacation"
  ADD COLUMN IF NOT EXISTS "agent_nom" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "matricule" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "prestataire_nom" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "site_id" UUID,
  ADD COLUMN IF NOT EXISTS "poste_nom" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "shift_type" "shift_agent",
  ADD COLUMN IF NOT EXISTS "checklist" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "observations" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vacation_site') THEN
    ALTER TABLE "vacation" ADD CONSTRAINT "fk_vacation_site"
      FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "passage_vehicule"
  ADD COLUMN IF NOT EXISTS "transporteur" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "conducteur" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "passagers" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "motif" TEXT,
  ADD COLUMN IF NOT EXISTS "zone" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "operation" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "reference" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "plomb" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "etat_chargement" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "controle_conforme" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "saisi_par_id" UUID,
  ADD COLUMN IF NOT EXISTS "sortie_par_id" UUID,
  ADD COLUMN IF NOT EXISTS "site_id" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_passagevehicule_site') THEN
    ALTER TABLE "passage_vehicule" ADD CONSTRAINT "fk_passagevehicule_site"
      FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "passation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sortant_nom" VARCHAR(255) NOT NULL, "sortant_matricule" VARCHAR(50) NOT NULL,
  "entrant_nom" VARCHAR(255) NOT NULL, "entrant_matricule" VARCHAR(50) NOT NULL,
  "poste_nom" VARCHAR(160) NOT NULL, "materiel" TEXT, "evenements" TEXT, "consignes" TEXT,
  "confirmation_sortant" BOOLEAN NOT NULL DEFAULT false, "confirmation_entrant" BOOLEAN NOT NULL DEFAULT false,
  "utilisateur_id" UUID NOT NULL, "site_id" UUID, "vacation_id" UUID,
  CONSTRAINT "passation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_passation_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_passation_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "fk_passation_vacation" FOREIGN KEY ("vacation_id") REFERENCES "vacation"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_passation_site_date" ON "passation"("site_id", "cree_le");
CREATE INDEX IF NOT EXISTS "idx_passage_site_presence" ON "passage"("visiteur_id", "sortie");
CREATE INDEX IF NOT EXISTS "idx_passagevehicule_site_date" ON "passage_vehicule"("site_id", "entree");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_passagevehicule_open_vehicle" ON "passage_vehicule"("vehicule_id") WHERE "sortie" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_vacation_open_matricule" ON "vacation"("matricule") WHERE "matricule" IS NOT NULL AND "cloture" IS NULL;
DROP INDEX IF EXISTS "uq_vacation_open_matricule";

ALTER TABLE "site" ADD COLUMN IF NOT EXISTS "actif" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "suivi_cle" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_suivi" DATE NOT NULL, "lieu" VARCHAR(255) NOT NULL,
  "perception_matin" TIME(0), "responsable_perception_matin" VARCHAR(255),
  "reintegration_matin" TIME(0), "responsable_reintegration_matin" VARCHAR(255),
  "perception_apres_midi" TIME(0), "responsable_perception_apres_midi" VARCHAR(255),
  "reintegration_apres_midi" TIME(0), "responsable_reintegration_apres_midi" VARCHAR(255),
  "observations" TEXT, "site_id" UUID NOT NULL, "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "suivi_cle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_suivi_cle_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_suivi_cle_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_suivi_cle_site_date" ON "suivi_cle"("site_id", "date_suivi");

CREATE TABLE IF NOT EXISTS "controle_alcoolemie" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_controle" DATE NOT NULL, "heure" TIME(0) NOT NULL, "personne" VARCHAR(255) NOT NULL,
  "appartenance" VARCHAR(40) NOT NULL, "demandeur" VARCHAR(255), "type_demande" VARCHAR(80) NOT NULL,
  "resultat" VARCHAR(20) NOT NULL, "taux_mesure" DECIMAL(5,2), "site_id" UUID NOT NULL, "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "controle_alcoolemie_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_controle_alcoolemie_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_controle_alcoolemie_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "controle_alcoolemie_resultat_check" CHECK ("resultat" IN ('Positif', 'Négatif')),
  CONSTRAINT "controle_alcoolemie_appartenance_check" CHECK ("appartenance" IN ('STAR', 'NON STAR')),
  CONSTRAINT "controle_alcoolemie_taux_check" CHECK ("taux_mesure" IS NULL OR "taux_mesure" >= 0)
);
CREATE INDEX IF NOT EXISTS "idx_alcoolemie_site_date" ON "controle_alcoolemie"("site_id", "date_controle", "heure");

CREATE TABLE IF NOT EXISTS "flux_logistique" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL, "type_flux" VARCHAR(20) NOT NULL, "camion" VARCHAR(160),
  "transporteur" VARCHAR(255), "document" VARCHAR(160), "plomb" VARCHAR(100), "categorie_stock" VARCHAR(40),
  "article" VARCHAR(100), "quantite" DECIMAL(12,2), "site_id" UUID NOT NULL, "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "flux_logistique_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_flux_logistique_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_flux_logistique_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "flux_logistique_type_check" CHECK ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT', 'INVENTAIRE')),
  CONSTRAINT "flux_logistique_stock_check" CHECK (("type_flux" = 'INVENTAIRE' AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX') AND "article" IS NOT NULL AND "quantite" IS NOT NULL AND "quantite" >= 0) OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT') AND "camion" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "idx_flux_logistique_site_date" ON "flux_logistique"("site_id", "date_operation", "type_flux");

CREATE TABLE IF NOT EXISTS "ronde" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nom_parcours" VARCHAR(160) NOT NULL, "debut" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fin" TIMESTAMP(6), "points" JSONB NOT NULL DEFAULT '[]', "observations" TEXT,
  "site_id" UUID NOT NULL, "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "ronde_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_ronde_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_ronde_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_ronde_site_debut" ON "ronde"("site_id", "debut");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ronde_agent_active" ON "ronde"("utilisateur_id") WHERE "fin" IS NULL;
