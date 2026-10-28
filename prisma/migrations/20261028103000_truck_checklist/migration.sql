CREATE TABLE IF NOT EXISTS "truck_checklist" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "date_operation" DATE NOT NULL,
  "rows" JSONB NOT NULL,
  "site_id" UUID NOT NULL,
  "utilisateur_id" UUID NOT NULL,
  "cree_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modifie_le" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "truck_checklist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "truck_checklist_rows_check"
    CHECK (CASE
      WHEN jsonb_typeof("rows") = 'array' THEN jsonb_array_length("rows") BETWEEN 1 AND 100
      ELSE false
    END),
  CONSTRAINT "fk_truck_checklist_site"
    FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fk_truck_checklist_utilisateur"
    FOREIGN KEY ("utilisateur_id") REFERENCES "utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_truck_checklist_site_date"
  ON "truck_checklist"("site_id", "date_operation");
