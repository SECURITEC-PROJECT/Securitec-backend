CREATE TABLE "ronde" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nom_parcours" VARCHAR(160) NOT NULL,
  "debut" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fin" TIMESTAMP(6),
  "points" JSONB NOT NULL DEFAULT '[]',
  "observations" TEXT,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "ronde_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_ronde_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_ronde_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "idx_ronde_site_debut" ON "ronde"("site_id", "debut");
CREATE UNIQUE INDEX "idx_ronde_agent_active" ON "ronde"("utilisateur_id") WHERE "fin" IS NULL;
