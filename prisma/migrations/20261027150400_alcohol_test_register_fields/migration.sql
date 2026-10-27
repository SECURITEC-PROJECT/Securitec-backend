ALTER TABLE "controle_alcoolemie"
  ADD COLUMN IF NOT EXISTS "matricule" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "fonction" VARCHAR(40);
