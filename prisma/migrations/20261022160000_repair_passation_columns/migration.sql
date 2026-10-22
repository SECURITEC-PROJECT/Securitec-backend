-- La table passation existe dans certaines bases avec seulement ses colonnes
-- relationnelles. Ajouter les colonnes métier attendues par le backend sans
-- supprimer ni réinitialiser les enregistrements existants.
ALTER TABLE "passation"
  ADD COLUMN IF NOT EXISTS "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "sortant_nom" VARCHAR(255) NOT NULL DEFAULT 'Non renseigné',
  ADD COLUMN IF NOT EXISTS "sortant_matricule" VARCHAR(50) NOT NULL DEFAULT 'Non renseigné',
  ADD COLUMN IF NOT EXISTS "entrant_nom" VARCHAR(255) NOT NULL DEFAULT 'Non renseigné',
  ADD COLUMN IF NOT EXISTS "entrant_matricule" VARCHAR(50) NOT NULL DEFAULT 'Non renseigné',
  ADD COLUMN IF NOT EXISTS "poste_nom" VARCHAR(160) NOT NULL DEFAULT 'Non renseigné',
  ADD COLUMN IF NOT EXISTS "materiel" TEXT,
  ADD COLUMN IF NOT EXISTS "evenements" TEXT,
  ADD COLUMN IF NOT EXISTS "consignes" TEXT,
  ADD COLUMN IF NOT EXISTS "confirmation_sortant" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "confirmation_entrant" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "idx_passation_site_date"
  ON "passation" ("site_id", "cree_le");
