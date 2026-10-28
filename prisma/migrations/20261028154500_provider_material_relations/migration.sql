ALTER TABLE "materiel_sous_traitant"
  ADD COLUMN IF NOT EXISTS "prestataire_id" UUID;

ALTER TABLE "materiel_star"
  ADD COLUMN IF NOT EXISTS "prestataire_id" UUID;

INSERT INTO "prestataire" ("nom", "actif")
SELECT DISTINCT LEFT(BTRIM("entreprise"), 160), true
FROM "materiel_sous_traitant"
WHERE NULLIF(BTRIM("entreprise"), '') IS NOT NULL
ON CONFLICT ("nom") DO NOTHING;

INSERT INTO "prestataire" ("nom", "actif")
VALUES ('À affecter (anciens matériels)', false)
ON CONFLICT ("nom") DO NOTHING;

UPDATE "materiel_sous_traitant" AS material
SET "prestataire_id" = (
  SELECT p.id
  FROM "prestataire" AS p
  WHERE LOWER(BTRIM(p.nom)) = LOWER(LEFT(BTRIM(material.entreprise), 160))
    AND (
      SELECT COUNT(*)
      FROM "prestataire" AS matching_provider
      WHERE LOWER(BTRIM(matching_provider.nom)) = LOWER(LEFT(BTRIM(material.entreprise), 160))
    ) = 1
  ORDER BY p.actif DESC, p.nom, p.id
  LIMIT 1
)
WHERE material.prestataire_id IS NULL;

UPDATE "materiel_star" AS material
SET "prestataire_id" = employee.prestataire_id
FROM "employe" AS employee
WHERE material.prestataire_id IS NULL
  AND UPPER(BTRIM(material.matricule)) = UPPER(BTRIM(employee.matricule))
  AND (
    SELECT COUNT(*)
    FROM "employe" AS matching_employee
    WHERE UPPER(BTRIM(material.matricule)) = UPPER(BTRIM(matching_employee.matricule))
  ) = 1;

UPDATE "materiel_sous_traitant"
SET "prestataire_id" = (SELECT id FROM "prestataire" WHERE nom='À affecter (anciens matériels)')
WHERE "prestataire_id" IS NULL;

UPDATE "materiel_star"
SET "prestataire_id" = (SELECT id FROM "prestataire" WHERE nom='À affecter (anciens matériels)')
WHERE "prestataire_id" IS NULL;

ALTER TABLE "materiel_sous_traitant"
  ALTER COLUMN "prestataire_id" SET NOT NULL;
ALTER TABLE "materiel_star"
  ALTER COLUMN "prestataire_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_materiel_sous_traitant_prestataire') THEN
    ALTER TABLE "materiel_sous_traitant"
      ADD CONSTRAINT "fk_materiel_sous_traitant_prestataire"
      FOREIGN KEY ("prestataire_id") REFERENCES "prestataire"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_materiel_star_prestataire') THEN
    ALTER TABLE "materiel_star"
      ADD CONSTRAINT "fk_materiel_star_prestataire"
      FOREIGN KEY ("prestataire_id") REFERENCES "prestataire"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_materiel_sous_traitant_prestataire"
  ON "materiel_sous_traitant"("prestataire_id");
CREATE INDEX IF NOT EXISTS "idx_materiel_star_prestataire"
  ON "materiel_star"("prestataire_id");
