-- Keep employee records and foreign keys intact while adopting the current table name.
DO $$
BEGIN
  IF to_regclass('public.employe') IS NULL AND to_regclass('public.agent') IS NOT NULL THEN
    ALTER TABLE "agent" RENAME TO "employe";
  END IF;
END $$;

ALTER TABLE IF EXISTS "employe" ADD COLUMN IF NOT EXISTS "site_id" UUID;
CREATE INDEX IF NOT EXISTS "idx_employe_site" ON "employe"("site_id");
