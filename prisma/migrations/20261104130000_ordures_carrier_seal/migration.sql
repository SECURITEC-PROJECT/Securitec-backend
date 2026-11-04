ALTER TABLE "flux_logistique"
  ADD CONSTRAINT "flux_logistique_ordures_transporteur_check"
  CHECK (
    "type_flux" <> 'ORDURES'
    OR NULLIF(BTRIM("transporteur"), '') IS NOT NULL
  ) NOT VALID;
