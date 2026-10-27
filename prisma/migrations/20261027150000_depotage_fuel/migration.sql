ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "titre" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "cree" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "chauffeur" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "magasinier" VARCHAR(160);

ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_type_check",
  DROP CONSTRAINT IF EXISTS "flux_logistique_stock_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_type_check"
    CHECK ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT', 'INVENTAIRE', 'DECHETS', 'MATIERE_PREMIERE', 'DEPOTAGE_FUEL')) NOT VALID,
  ADD CONSTRAINT "flux_logistique_stock_check"
    CHECK (
      ("type_flux" = 'INVENTAIRE' AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX') AND "article" IS NOT NULL AND "quantite" IS NOT NULL AND "quantite" >= 0)
      OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT') AND "camion" IS NOT NULL)
      OR ("type_flux" = 'DECHETS' AND "heure_sortie" IS NOT NULL AND "numero_pesage" IS NOT NULL AND "facture" IS NOT NULL AND "poids" > 0 AND "destinataire" IS NOT NULL AND "vehicule" IS NOT NULL)
      OR ("type_flux" = 'MATIERE_PREMIERE' AND "camion" IS NOT NULL AND "heure_pointe" IS NOT NULL AND "designation" IS NOT NULL AND "quantite" > 0 AND "document" IS NOT NULL AND "provenance" IS NOT NULL)
      OR ("type_flux" = 'DEPOTAGE_FUEL' AND "heure_pointe" IS NOT NULL AND "titre" IS NOT NULL AND "plomb" IS NOT NULL AND "designation" IS NOT NULL AND "quantite" > 0 AND "cree" IS NOT NULL AND "chauffeur" IS NOT NULL AND "magasinier" IS NOT NULL)
    ) NOT VALID;
