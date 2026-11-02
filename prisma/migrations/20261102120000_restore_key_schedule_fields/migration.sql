ALTER TABLE "suivi_cle"
  ADD COLUMN IF NOT EXISTS "perception_matin" TIME(0),
  ADD COLUMN IF NOT EXISTS "responsable_perception_matin" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "reintegration_matin" TIME(0),
  ADD COLUMN IF NOT EXISTS "responsable_reintegration_matin" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "perception_apres_midi" TIME(0),
  ADD COLUMN IF NOT EXISTS "responsable_perception_apres_midi" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "reintegration_apres_midi" TIME(0),
  ADD COLUMN IF NOT EXISTS "responsable_reintegration_apres_midi" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "observations" TEXT;
