ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "heure_sortie" TIME(0),
  ADD COLUMN IF NOT EXISTS "numero_pesage" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "facture" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "poids" DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS "destinataire" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "vehicule" VARCHAR(160);

ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_type_check",
  DROP CONSTRAINT IF EXISTS "flux_logistique_stock_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_type_check"
    CHECK ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT', 'INVENTAIRE', 'DECHETS')) NOT VALID,
  ADD CONSTRAINT "flux_logistique_stock_check"
    CHECK (
      ("type_flux" = 'INVENTAIRE' AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX') AND "article" IS NOT NULL AND "quantite" IS NOT NULL AND "quantite" >= 0)
      OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT') AND "camion" IS NOT NULL)
      OR ("type_flux" = 'DECHETS' AND "heure_sortie" IS NOT NULL AND "numero_pesage" IS NOT NULL AND "facture" IS NOT NULL AND "poids" > 0 AND "destinataire" IS NOT NULL AND "vehicule" IS NOT NULL)
    ) NOT VALID;
