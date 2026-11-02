-- Forward-only additive migration: use a new migration for any production rollback.
CREATE TABLE "pond_brut" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flux_id" UUID NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "date_operation" DATE NOT NULL,
  "brut" DECIMAL(12,2) NOT NULL,
  "tare" DECIMAL(12,2) NOT NULL,
  "net" DECIMAL(12,2) NOT NULL,
  "observation" TEXT NOT NULL DEFAULT '',
  "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pond_brut_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pond_brut_pesage_check" CHECK (
    "brut" > 0 AND "tare" > 0 AND "net" > 0 AND "net" = "brut" - "tare"
  ),
  CONSTRAINT "fk_pond_brut_flux" FOREIGN KEY ("flux_id")
    REFERENCES "flux_logistique"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_pond_brut_site" FOREIGN KEY ("site_id")
    REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_pond_brut_utilisateur" FOREIGN KEY ("utilisateur_id")
    REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pond_brut_flux_id_key" ON "pond_brut"("flux_id");
CREATE INDEX "idx_pond_brut_site_date" ON "pond_brut"("site_id", "date_operation" DESC);
