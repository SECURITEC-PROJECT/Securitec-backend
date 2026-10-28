CREATE TABLE IF NOT EXISTS "declaration_objet" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "donnees" JSONB NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "declaration_objet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_declaration_objet_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_declaration_objet_utilisateur"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_declaration_objet_site_date"
  ON "declaration_objet"("site_id", "date_operation", "cree_le");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_declaration_objet_site_numero"
  ON "declaration_objet"("site_id", (lower("donnees"->>'referenceNumber')))
  WHERE NULLIF(BTRIM("donnees"->>'referenceNumber'), '') IS NOT NULL;
