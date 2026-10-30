CREATE TABLE IF NOT EXISTS "mouvement_aps_evenement_service_poste" (
  "mouvement_aps_evenement_id" UUID NOT NULL,
  "service_poste_id" UUID NOT NULL,
  CONSTRAINT "mouvement_aps_evenement_service_poste_pkey" PRIMARY KEY ("mouvement_aps_evenement_id","service_poste_id"),
  CONSTRAINT "fk_mouvement_aps_evenement_service_poste_event" FOREIGN KEY ("mouvement_aps_evenement_id") REFERENCES "mouvement_aps_evenement"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_aps_evenement_service_poste_service" FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "idx_mouvement_aps_evenement_service_poste_service"
  ON "mouvement_aps_evenement_service_poste" ("service_poste_id");

INSERT INTO "mouvement_aps_evenement_service_poste" ("mouvement_aps_evenement_id","service_poste_id")
SELECT e."id",sp."id"
FROM "mouvement_aps_evenement" e
JOIN "service_poste" sp ON sp."site_id"=e."site_id"
  AND sp."started_at"::date<=e."date_operation"
  AND COALESCE(sp."ended_at"::date,CURRENT_DATE)>=e."date_operation"
ON CONFLICT DO NOTHING;
