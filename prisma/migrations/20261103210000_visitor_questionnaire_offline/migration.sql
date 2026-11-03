ALTER TABLE "questionnaire_visiteur"
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "client_request_id" UUID,
ADD COLUMN IF NOT EXISTS "update_request_id" UUID,
ADD COLUMN IF NOT EXISTS "delete_request_id" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_visiteur_client_request_id_key"
ON "questionnaire_visiteur"("client_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_visiteur_update_request_id_key"
ON "questionnaire_visiteur"("update_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "questionnaire_visiteur_delete_request_id_key"
ON "questionnaire_visiteur"("delete_request_id");