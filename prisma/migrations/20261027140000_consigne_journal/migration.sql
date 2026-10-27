CREATE TABLE IF NOT EXISTS "consigne_journal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "date_consigne" DATE NOT NULL,
  "heure" TIME(0) NOT NULL,
  "consigne" TEXT NOT NULL,
  "emetteur" VARCHAR(255) NOT NULL,
  "destinataire" VARCHAR(255) NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consigne_journal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_consigne_journal_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_consigne_journal_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_consigne_journal_site_date"
  ON "consigne_journal"("site_id", "date_consigne", "heure");
