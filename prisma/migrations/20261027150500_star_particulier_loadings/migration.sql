ALTER TABLE "flux_logistique"
  ADD COLUMN IF NOT EXISTS "type_chargement" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "proprietaire" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "quantite_texte" TEXT,
  ADD COLUMN IF NOT EXISTS "lp" VARCHAR(6);

ALTER TABLE "flux_logistique"
  DROP CONSTRAINT IF EXISTS "flux_logistique_chargement_details_check";

ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_chargement_details_check"
  CHECK (
    "type_chargement" IS NULL
    OR (
      "type_flux" = 'CHARGEMENT'
      AND "type_chargement" IN ('STAR', 'PARTICULIER')
      AND "heure_sortie" IS NOT NULL
      AND NULLIF(BTRIM("camion"), '') IS NOT NULL
      AND NULLIF(BTRIM("proprietaire"), '') IS NOT NULL
      AND NULLIF(BTRIM("nom_chauffeur"), '') IS NOT NULL
      AND NULLIF(BTRIM("designation"), '') IS NOT NULL
      AND NULLIF(BTRIM("quantite_texte"), '') IS NOT NULL
      AND "poids" IS NOT NULL
      AND NULLIF(BTRIM("destinataire"), '') IS NOT NULL
      AND "lp" IS NOT NULL
      AND "titre" IS NOT NULL
      AND "plomb" IS NOT NULL
      AND "lp" ~ '^[0-9]{1,6}$'
      AND "titre" ~ '^[0-9]{1,8}$'
      AND "plomb" ~ '^[0-9]{1,8}$'
    )
  ) NOT VALID;
