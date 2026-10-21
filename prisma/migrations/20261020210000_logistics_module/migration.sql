CREATE TABLE "flux_logistique" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date_operation" DATE NOT NULL,
  "type_flux" VARCHAR(20) NOT NULL,
  "camion" VARCHAR(160),
  "transporteur" VARCHAR(255),
  "document" VARCHAR(160),
  "plomb" VARCHAR(100),
  "categorie_stock" VARCHAR(40),
  "article" VARCHAR(100),
  "quantite" DECIMAL(12,2),
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  CONSTRAINT "flux_logistique_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fk_flux_logistique_site" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_flux_logistique_utilisateur" FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "flux_logistique_type_check" CHECK ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT', 'INVENTAIRE')),
  CONSTRAINT "flux_logistique_stock_check" CHECK (
    ("type_flux" = 'INVENTAIRE' AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX') AND "article" IS NOT NULL AND "quantite" IS NOT NULL AND "quantite" >= 0)
    OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT') AND "camion" IS NOT NULL)
  )
);
CREATE INDEX "idx_flux_logistique_site_date" ON "flux_logistique"("site_id", "date_operation", "type_flux");
