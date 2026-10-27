ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "heure_arrivee" TIME(0),
  ADD COLUMN IF NOT EXISTS "immatriculation_vehicule" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "numero_titre" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "provenance" TEXT,
  ADD COLUMN IF NOT EXISTS "details_bouteilles" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "flux_logistique"
  ALTER COLUMN "provenance" TYPE TEXT USING "provenance"::text;

ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_type_check",
  DROP CONSTRAINT IF EXISTS "flux_logistique_stock_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_type_check"
    CHECK ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT', 'INVENTAIRE', 'DECHETS', 'BOUTEILLES_VIDES')) NOT VALID,
  ADD CONSTRAINT "flux_logistique_stock_check"
    CHECK (
      ("type_flux" = 'INVENTAIRE' AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX') AND "article" IS NOT NULL AND "quantite" IS NOT NULL AND "quantite" >= 0)
      OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT') AND "camion" IS NOT NULL)
      OR ("type_flux" = 'DECHETS' AND "heure_sortie" IS NOT NULL AND "numero_pesage" IS NOT NULL AND "facture" IS NOT NULL AND "poids" > 0 AND "destinataire" IS NOT NULL AND "vehicule" IS NOT NULL)
      OR ("type_flux" = 'BOUTEILLES_VIDES'
          AND "heure_arrivee" IS NOT NULL
          AND NULLIF(BTRIM("immatriculation_vehicule"), '') IS NOT NULL
          AND "numero_titre" ~ '^[0-9]+$'
          AND "provenance"::text ~ '^[0-9]+$'
          AND "poids" > 0
          AND jsonb_typeof("details_bouteilles") = 'array'
          AND jsonb_array_length("details_bouteilles") > 0)
    ) NOT VALID;
