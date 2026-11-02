DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'suivi_cle'
      AND column_name = 'date_retour_prevue'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'suivi_cle'
      AND column_name = 'date_retour'
  ) THEN
    ALTER TABLE "suivi_cle" RENAME COLUMN "date_retour_prevue" TO "date_retour";
  END IF;
END $$;
