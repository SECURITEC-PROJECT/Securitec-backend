CREATE TABLE IF NOT EXISTS "document_site" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "nom" VARCHAR(240) NOT NULL,
  "extension" VARCHAR(12) NOT NULL,
  "mime_type" VARCHAR(160) NOT NULL,
  "taille" INTEGER NOT NULL,
  "categorie" VARCHAR(80) NOT NULL DEFAULT 'Autre',
  "contenu" BYTEA NOT NULL,
  "cree_le" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_site_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "document_site_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_site_utilisateur_id_fkey" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "document_site_taille_check" CHECK ("taille" > 0 AND "taille" <= 15728640)
);

CREATE INDEX IF NOT EXISTS "document_site_site_id_cree_le_idx"
  ON "document_site"("site_id", "cree_le" DESC);
