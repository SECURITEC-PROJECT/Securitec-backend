ALTER TABLE "suivi_cle"
  ADD COLUMN IF NOT EXISTS "cree_le" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "date_suivi" DATE,
  ADD COLUMN IF NOT EXISTS "nom_personne" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "prenom_personne" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "type_cle" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "nombre_cles" INTEGER,
  ADD COLUMN IF NOT EXISTS "heure_sortie" TIME(0),
  ADD COLUMN IF NOT EXISTS "heure_retour" TIME(0),
  ADD COLUMN IF NOT EXISTS "site_id" UUID,
  ADD COLUMN IF NOT EXISTS "utilisateur_id" UUID;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'suivi_cle'
      AND column_name = 'created_at'
  ) THEN
    EXECUTE 'UPDATE "suivi_cle"
             SET "date_suivi" = COALESCE("date_suivi", "created_at"::date, CURRENT_DATE),
                 "cree_le" = COALESCE("cree_le", "created_at", CURRENT_TIMESTAMP)';
  ELSE
    UPDATE "suivi_cle"
    SET "date_suivi" = COALESCE("date_suivi", CURRENT_DATE),
        "cree_le" = COALESCE("cree_le", CURRENT_TIMESTAMP);
  END IF;
END $$;

ALTER TABLE "suivi_cle"
  ALTER COLUMN "date_suivi" SET DEFAULT CURRENT_DATE,
  ALTER COLUMN "date_suivi" SET NOT NULL,
  ALTER COLUMN "cree_le" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "cree_le" SET NOT NULL,
  ALTER COLUMN "agent_gardien" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_suivi_cle_site') THEN
    ALTER TABLE "suivi_cle"
      ADD CONSTRAINT "fk_suivi_cle_site"
      FOREIGN KEY ("site_id") REFERENCES "site"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_suivi_cle_utilisateur') THEN
    ALTER TABLE "suivi_cle"
      ADD CONSTRAINT "fk_suivi_cle_utilisateur"
      FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_suivi_cle_site_date"
  ON "suivi_cle"("site_id", "date_suivi");
