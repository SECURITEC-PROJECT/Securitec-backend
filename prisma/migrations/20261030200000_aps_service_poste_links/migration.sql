CREATE TABLE IF NOT EXISTS "mouvement_aps_service_poste" (
  "mouvement_aps_id" UUID NOT NULL,
  "service_poste_id" UUID NOT NULL,
  CONSTRAINT "mouvement_aps_service_poste_pkey" PRIMARY KEY ("mouvement_aps_id","service_poste_id"),
  CONSTRAINT "fk_mouvement_aps_service_poste_movement" FOREIGN KEY ("mouvement_aps_id") REFERENCES "mouvement_aps"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_mouvement_aps_service_poste_service" FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "passation_aps_service_poste" (
  "passation_aps_id" UUID NOT NULL,
  "service_poste_id" UUID NOT NULL,
  CONSTRAINT "passation_aps_service_poste_pkey" PRIMARY KEY ("passation_aps_id","service_poste_id"),
  CONSTRAINT "fk_passation_aps_service_poste_handover" FOREIGN KEY ("passation_aps_id") REFERENCES "mouvement_aps_passation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "fk_passation_aps_service_poste_service" FOREIGN KEY ("service_poste_id") REFERENCES "service_poste"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_mouvement_aps_service_poste_service"
  ON "mouvement_aps_service_poste" ("service_poste_id");
CREATE INDEX IF NOT EXISTS "idx_passation_aps_service_poste_service"
  ON "passation_aps_service_poste" ("service_poste_id");

INSERT INTO "mouvement_aps_service_poste" ("mouvement_aps_id","service_poste_id")
SELECT m."id", sp."id"
FROM "mouvement_aps" m
JOIN "service_poste" sp ON sp."site_id"=m."site_id"
  AND sp."shift_type"=UPPER(m."service")::"shift_agent"
  AND sp."started_at"::date<=m."date_pointage"
  AND COALESCE(sp."ended_at"::date,CURRENT_DATE)>=m."date_pointage"
ON CONFLICT DO NOTHING;

INSERT INTO "passation_aps_service_poste" ("passation_aps_id","service_poste_id")
SELECT h."id", sp."id"
FROM "mouvement_aps_passation" h
JOIN "service_poste" sp ON sp."site_id"=h."site_id"
  AND sp."started_at"::date<=h."date_operation"
  AND COALESCE(sp."ended_at"::date,CURRENT_DATE)>=h."date_operation"
ON CONFLICT DO NOTHING;
