-- The employee CRUD restores provider records by marking them active.
ALTER TABLE IF EXISTS "prestataire"
  ADD COLUMN IF NOT EXISTS "actif" BOOLEAN NOT NULL DEFAULT TRUE;
