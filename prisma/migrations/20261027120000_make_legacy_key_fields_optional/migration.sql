DO $$
DECLARE
  legacy_column_name TEXT;
BEGIN
  FOREACH legacy_column_name IN ARRAY ARRAY[
    'trousse_cle',
    'lieu',
    'action',
    'personne_habilitee',
    'agent_gardien',
    'heure'
  ]
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = current_schema()
        AND c.table_name = 'suivi_cle'
        AND c.column_name = legacy_column_name
    ) THEN
      EXECUTE format('ALTER TABLE "suivi_cle" ALTER COLUMN %I DROP NOT NULL', legacy_column_name);
    END IF;
  END LOOP;
END $$;
