-- Pointage APS was storing post names only in its JSON configuration. Copy
-- every configured name into the canonical site post table so other modules
-- can reference the same post records.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_poste_site_nom"
  ON "poste"("site_id", "nom");

INSERT INTO "poste" ("nom", "actif", "site_id")
SELECT DISTINCT BTRIM(item.value->>'name'), true, configuration."site_id"
FROM "configuration_postes_mouvement_aps" configuration
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(configuration."postes") = 'array'
    THEN configuration."postes" ELSE '[]'::jsonb END
) AS item(value)
WHERE NULLIF(BTRIM(item.value->>'name'), '') IS NOT NULL
ON CONFLICT ("site_id", "nom") DO UPDATE SET "actif" = true;
