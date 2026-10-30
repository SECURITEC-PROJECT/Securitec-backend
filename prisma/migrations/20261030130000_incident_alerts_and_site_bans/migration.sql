ALTER TABLE "consigne_journal"
  ADD COLUMN IF NOT EXISTS "poste_id" UUID;

DO $$ BEGIN
  ALTER TABLE "consigne_journal"
    ADD CONSTRAINT "fk_consigne_journal_poste"
    FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_consigne_journal_site_poste_active"
  ON "consigne_journal" ("site_id", "poste_id", "date_fin");

CREATE TABLE IF NOT EXISTS "notification_interne" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "utilisateur_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "titre" VARCHAR(200) NOT NULL,
  "message" TEXT NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "entite_id" UUID,
  "lue_le" TIMESTAMPTZ(6),
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notification_interne_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_notification_interne_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_notification_interne_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_notification_interne_user_unread"
  ON "notification_interne" ("utilisateur_id", "cree_le" DESC) WHERE "lue_le" IS NULL;
