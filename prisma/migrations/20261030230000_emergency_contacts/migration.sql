CREATE TABLE "contact_urgence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "site_id" UUID NOT NULL,
  "nom" VARCHAR(160) NOT NULL,
  "fonction" VARCHAR(120) NOT NULL DEFAULT '',
  "telephone" VARCHAR(40) NOT NULL,
  "email" VARCHAR(255),
  "instructions" TEXT,
  "actif" BOOLEAN NOT NULL DEFAULT TRUE,
  "ordre" INTEGER NOT NULL DEFAULT 0,
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_par" UUID,
  CONSTRAINT "contact_urgence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_contact_urgence_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_contact_urgence_modifie_par" FOREIGN KEY ("modifie_par") REFERENCES "utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "idx_contact_urgence_site_actif"
  ON "contact_urgence" ("site_id", "actif", "ordre", "nom");
