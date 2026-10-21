-- Required by employee/provider upserts using ON CONFLICT (nom).
CREATE UNIQUE INDEX IF NOT EXISTS "prestataire_nom_key"
  ON "prestataire"("nom");
