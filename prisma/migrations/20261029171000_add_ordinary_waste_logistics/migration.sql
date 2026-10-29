ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_type_check",
  DROP CONSTRAINT IF EXISTS "flux_logistique_stock_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_type_check"
    CHECK ("type_flux" IN (
      'DECHARGEMENT',
      'CHARGEMENT',
      'INVENTAIRE',
      'DECHETS',
      'BOUTEILLES_VIDES',
      'MATIERE_PREMIERE',
      'DEPOTAGE_FUEL',
      'ORDURES'
    )) NOT VALID,
  ADD CONSTRAINT "flux_logistique_stock_check"
    CHECK (
      ("type_flux" = 'INVENTAIRE'
        AND "categorie_stock" IN ('VIDES', 'PLEINS_EAUX')
        AND "article" IS NOT NULL
        AND "quantite" IS NOT NULL
        AND "quantite" >= 0)
      OR ("type_flux" IN ('DECHARGEMENT', 'CHARGEMENT')
        AND "camion" IS NOT NULL)
      OR ("type_flux" = 'DECHETS'
        AND "heure_sortie" IS NOT NULL
        AND "numero_pesage" IS NOT NULL
        AND "facture" IS NOT NULL
        AND "poids" > 0
        AND "destinataire" IS NOT NULL
        AND "vehicule" IS NOT NULL)
      OR ("type_flux" = 'BOUTEILLES_VIDES'
        AND "heure_arrivee" IS NOT NULL
        AND NULLIF(BTRIM("immatriculation_vehicule"), '') IS NOT NULL
        AND "numero_titre" ~ '^[0-9]+$'
        AND "provenance"::text ~ '^[0-9]+$'
        AND "poids" > 0
        AND jsonb_typeof("details_bouteilles") = 'array'
        AND jsonb_array_length("details_bouteilles") > 0)
      OR ("type_flux" = 'MATIERE_PREMIERE'
        AND "camion" IS NOT NULL
        AND "heure_pointe" IS NOT NULL
        AND "designation" IS NOT NULL
        AND "quantite" > 0
        AND "document" IS NOT NULL
        AND "provenance" IS NOT NULL)
      OR ("type_flux" = 'DEPOTAGE_FUEL'
        AND "heure_pointe" IS NOT NULL
        AND "titre" IS NOT NULL
        AND "plomb" IS NOT NULL
        AND "designation" IS NOT NULL
        AND "quantite" > 0
        AND "cree" IS NOT NULL
        AND "chauffeur" IS NOT NULL
        AND "magasinier" IS NOT NULL)
      OR ("type_flux" = 'ORDURES'
        AND NULLIF(BTRIM("immatriculation_vehicule"), '') IS NOT NULL
        AND "designation" IN ('Verres cassées', 'Ordures', 'Gravat')
        AND NULLIF(BTRIM("nbr"), '') IS NOT NULL
        AND "facture" ~ '^[0-9]+$'
        AND NULLIF(BTRIM("destinataire"), '') IS NOT NULL)
    ) NOT VALID;
