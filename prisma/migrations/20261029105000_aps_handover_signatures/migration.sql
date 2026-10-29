ALTER TABLE "mouvement_aps_passation"
  ADD COLUMN IF NOT EXISTS "cp_descendant_matricule" VARCHAR(50) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "cp_montant_matricule" VARCHAR(50) NOT NULL DEFAULT '';
