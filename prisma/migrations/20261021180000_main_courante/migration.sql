CREATE TABLE IF NOT EXISTS "main_courante" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type_entree" VARCHAR(40) NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "severity" VARCHAR(20) NOT NULL,
  "zone" VARCHAR(255),
  "people" VARCHAR(255),
  "statut_auteur" VARCHAR(80),
  "nature_violation" VARCHAR(160),
  "description" TEXT NOT NULL,
  "mesures_prises" TEXT,
  "heure" TIME(0) NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "main_courante_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_main_courante_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_main_courante_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "main_courante_type_check" CHECK ("type_entree" IN ('STANDARD', 'VIOLATION', 'DIVERS')),
  CONSTRAINT "main_courante_severity_check" CHECK ("severity" IN ('normal', 'important', 'grave', 'urgent'))
);

CREATE INDEX IF NOT EXISTS "idx_main_courante_site_date" ON "main_courante"("site_id", "cree_le" DESC);
