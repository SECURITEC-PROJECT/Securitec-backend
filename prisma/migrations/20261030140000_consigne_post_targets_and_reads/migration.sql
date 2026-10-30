CREATE TABLE IF NOT EXISTS "consigne_journal_poste" (
  "consigne_id" UUID NOT NULL,
  "poste_id" UUID NOT NULL,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consigne_journal_poste_pkey" PRIMARY KEY ("consigne_id", "poste_id"),
  CONSTRAINT "fk_consigne_journal_poste_consigne" FOREIGN KEY ("consigne_id") REFERENCES "consigne_journal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_consigne_journal_poste_poste" FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "consigne_journal_poste" ("consigne_id", "poste_id")
SELECT "id", "poste_id" FROM "consigne_journal" WHERE "poste_id" IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS "consigne_lecture" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "consigne_id" UUID NOT NULL,
  "poste_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "lu_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "consigne_lecture_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_consigne_lecture_user_post" UNIQUE ("consigne_id", "poste_id", "utilisateur_id"),
  CONSTRAINT "fk_consigne_lecture_consigne" FOREIGN KEY ("consigne_id") REFERENCES "consigne_journal"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_consigne_lecture_poste" FOREIGN KEY ("poste_id") REFERENCES "poste"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_consigne_lecture_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_consigne_lecture_poste_read"
  ON "consigne_lecture" ("consigne_id", "poste_id", "lu_le" DESC);
