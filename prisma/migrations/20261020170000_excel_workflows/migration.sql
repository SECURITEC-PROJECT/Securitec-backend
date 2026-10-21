ALTER TABLE "passage"
  ADD COLUMN "type_piece" VARCHAR(80),
  ADD COLUMN "piece_fin" VARCHAR(4),
  ADD COLUMN "hote" VARCHAR(255),
  ADD COLUMN "zone" VARCHAR(255),
  ADD COLUMN "materiel" TEXT,
  ADD COLUMN "immatriculation" VARCHAR(50),
  ADD COLUMN "notes_sortie" TEXT,
  ADD COLUMN "badge_numero" VARCHAR(80),
  ADD COLUMN "saisi_par_id" UUID,
  ADD COLUMN "sortie_par_id" UUID;

ALTER TABLE "vacation"
  ADD COLUMN "agent_nom" VARCHAR(255), c  
  ADD COLUMN "matricule" VARCHAR(50),
  ADD COLUMN "prestataire_nom" VARCHAR(160),
  ADD COLUMN "site_id" UUID,
  ADD COLUMN "poste_nom" VARCHAR(160),
  ADD COLUMN "shift_type" "shift_agent",
  ADD COLUMN "checklist" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "observations" TEXT;

ALTER TABLE "vacation"
  ADD CONSTRAINT "fk_vacation_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "passage_vehicule"
  ADD COLUMN "transporteur" VARCHAR(255),
  ADD COLUMN "conducteur" VARCHAR(255),
  ADD COLUMN "passagers" VARCHAR(255),
  ADD COLUMN "motif" TEXT,
  ADD COLUMN "zone" VARCHAR(255),
  ADD COLUMN "operation" VARCHAR(40),
  ADD COLUMN "reference" VARCHAR(100),
  ADD COLUMN "plomb" VARCHAR(100),
  ADD COLUMN "etat_chargement" VARCHAR(40),
  ADD COLUMN "controle_conforme" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "saisi_par_id" UUID,
  ADD COLUMN "sortie_par_id" UUID,
  ADD COLUMN "site_id" UUID;

CREATE TABLE "passation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sortant_nom" VARCHAR(255) NOT NULL,
  "sortant_matricule" VARCHAR(50) NOT NULL,
  "entrant_nom" VARCHAR(255) NOT NULL,
  "entrant_matricule" VARCHAR(50) NOT NULL,
  "poste_nom" VARCHAR(160) NOT NULL,
  "materiel" TEXT,
  "evenements" TEXT,
  "consignes" TEXT,
  "confirmation_sortant" BOOLEAN NOT NULL DEFAULT false,
  "confirmation_entrant" BOOLEAN NOT NULL DEFAULT false,
  "utilisateur_id" UUID NOT NULL,
  "site_id" UUID,
  "vacation_id" UUID,
  CONSTRAINT "passation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_passation_site_date" ON "passation"("site_id", "cree_le");
CREATE INDEX "idx_passage_site_presence" ON "passage"("visiteur_id", "sortie");
CREATE INDEX "idx_passagevehicule_presence" ON "passage_vehicule"("vehicule_id", "sortie");
CREATE INDEX "idx_passagevehicule_site_date" ON "passage_vehicule"("site_id", "entree");
CREATE UNIQUE INDEX "uq_passagevehicule_open_vehicle" ON "passage_vehicule"("vehicule_id") WHERE "sortie" IS NULL;
CREATE UNIQUE INDEX "uq_vacation_open_matricule" ON "vacation"("matricule") WHERE "matricule" IS NOT NULL AND "cloture" IS NULL;

ALTER TABLE "passation"
  ADD CONSTRAINT "fk_passation_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "fk_passation_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "fk_passation_vacation" FOREIGN KEY ("vacation_id") REFERENCES "vacation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "passage_vehicule"
  ADD CONSTRAINT "fk_passagevehicule_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
